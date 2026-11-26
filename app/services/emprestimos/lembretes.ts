import { addDays, parseISO, differenceInCalendarDays, format } from "date-fns";
import { z } from "zod";
import { Prisma } from "../../../generated/client";
import { AppRequirementError } from "../../utils/appRequirementError";
import { prisma } from "../../utils/prisma";
import { resolveConfiguredInstance } from "../clientes/clienteWhatsappService";
import { resolveClienteWhatsappPhone } from "../clientes/clienteWhatsappPolicy";
import { contaHasActiveModule } from "../contas/storeModulesService";
import { dispatchClienteReminder } from "../financeiro/clienteReminderChannels";
import {
  DEFAULT_LEMBRETE_DIAS, DEFAULT_MENSAGEM_INADIMPLENCIA, MAX_DIA_OFFSET, MIN_DIA_OFFSET, normalizeDiasLembrete,
} from "../financeiro/inadimplenciaLembretePolicy";
import {
  buildMensagemInadimplencia, getContaDefaults, resolveContaDefaults, type InadimplenciaReminderSummary,
} from "../financeiro/inadimplenciaReminderService";
import { cotarParcela, diaLocal, inicioDiaFinanceiro } from "./policy";

export const lembreteEmprestimoSchema = z.object({
  ativo: z.boolean(),
  dias: z.array(z.number().int().min(MIN_DIA_OFFSET).max(MAX_DIA_OFFSET)).max(121),
  instanciaId: z.number().int().positive().max(2_147_483_647).nullable(),
  mensagemCustom: z.string().trim().max(1000).nullable(),
}).superRefine(({ ativo, dias, instanciaId }, ctx) => {
  if (ativo && !dias.length) ctx.addIssue({ code: "custom", path: ["dias"], message: "Selecione ao menos um dia de envio." });
  if (ativo && !instanciaId) ctx.addIssue({ code: "custom", path: ["instanciaId"], message: "Selecione uma instância de WhatsApp para o envio." });
});

export const resumoLembreteSelect = {
  ativo: true, instancia: { select: { nome: true, ativo: true, status: true } },
} satisfies Prisma.EmprestimoLembreteSelect;

async function carregarEmprestimo(contaId: number, id: number) {
  const emprestimo = await prisma.emprestimo.findFirst({
    where: { id, contaId },
    select: {
      id: true,
      cliente: { select: { whastapp: true, telefone: true } },
      lembrete: { select: { ativo: true, instanciaId: true, diasLembrete: true, mensagemCustom: true } },
    },
  });
  if (!emprestimo) throw new AppRequirementError("Empréstimo não encontrado.", "emprestimo_operacao", 404);
  return emprestimo;
}

function clienteTemWhatsApp(cliente: { whastapp: string | null; telefone: string | null }) {
  return Boolean(resolveClienteWhatsappPhone(undefined, cliente.whastapp, cliente.telefone));
}

export async function lerLembreteEmprestimo(contaId: number, id: number) {
  const { cliente, lembrete } = await carregarEmprestimo(contaId, id);
  const [defaultsMap, whatsappAtivo] = await Promise.all([
    getContaDefaults([contaId]), contaHasActiveModule(contaId, "whatsapp"),
  ]);
  const defaults = resolveContaDefaults(defaultsMap, contaId);
  const diasPadrao = normalizeDiasLembrete(defaults.defaultDias);
  const instancias = whatsappAtivo ? await prisma.whatsAppInstancia.findMany({
    where: { contaId, ativo: true },
    select: { id: true, nome: true, status: true, numeroConectado: true },
    orderBy: [{ nome: "asc" }, { id: "asc" }],
  }) : [];
  return {
    ativo: lembrete?.ativo ?? true,
    dias: lembrete ? normalizeDiasLembrete(lembrete.diasLembrete) : diasPadrao.length ? diasPadrao : [...DEFAULT_LEMBRETE_DIAS],
    instanciaId: lembrete?.instanciaId ?? null,
    mensagemCustom: lembrete?.mensagemCustom ?? null,
    mensagemPadrao: defaults.defaultMensagem?.trim() || DEFAULT_MENSAGEM_INADIMPLENCIA,
    horaEnvio: defaults.horaEnvio,
    enviosHabilitados: defaults.enabled,
    whatsappAtivo,
    clienteTemWhatsApp: clienteTemWhatsApp(cliente),
    instancias,
  };
}

export async function salvarLembreteEmprestimo(contaId: number, id: number, input: z.infer<typeof lembreteEmprestimoSchema>) {
  const { cliente, lembrete } = await carregarEmprestimo(contaId, id);
  let instanciaId = lembrete?.instanciaId ?? null;
  if (input.ativo) {
    if (!clienteTemWhatsApp(cliente)) {
      throw new AppRequirementError("Cadastre um telefone ou WhatsApp válido no cliente.", "emprestimo_lembrete_cliente_sem_whatsapp", 422);
    }
    if (!input.instanciaId) throw new AppRequirementError("Selecione uma instância de WhatsApp para o envio.", "whatsapp_instance_required", 422);
    instanciaId = (await resolveConfiguredInstance(contaId, input.instanciaId)).id;
  }
  const config = {
    ativo: input.ativo, diasLembrete: normalizeDiasLembrete(input.dias), instanciaId,
    mensagemCustom: input.mensagemCustom || null,
  };
  return prisma.emprestimoLembrete.upsert({
    where: { emprestimoId: id }, create: { emprestimoId: id, ...config }, update: config,
    select: resumoLembreteSelect,
  });
}

const horaFinanceira = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23",
});

export async function processEmprestimoReminders(agora = new Date()): Promise<InadimplenciaReminderSummary> {
  const resumo: InadimplenciaReminderSummary = { checked: 0, sent: 0, skipped: 0, failed: 0, errors: [] };
  const hoje = diaLocal(agora);
  const diaHoje = parseISO(hoje);
  const hora = Number(horaFinanceira.format(agora));
  const vencimento = {
    gte: inicioDiaFinanceiro(format(addDays(diaHoje, -MAX_DIA_OFFSET), "yyyy-MM-dd")),
    lt: inicioDiaFinanceiro(format(addDays(diaHoje, -MIN_DIA_OFFSET + 1), "yyyy-MM-dd")),
  };
  const pendenteNaJanela = { recebidoEm: null, vencimento } as const;
  const agendas = await prisma.emprestimoLembrete.findMany({
    where: {
      ativo: true, instancia: { ativo: true, status: "CONECTADA" },
      emprestimo: { parcelas: { some: pendenteNaJanela } },
    },
    include: {
      emprestimo: {
        include: {
          cliente: { select: { nome: true, whastapp: true, telefone: true } },
          parcelas: { where: { recebidoEm: null } },
          _count: { select: { parcelas: true } },
        },
      },
    },
  });
  if (!agendas.length) return resumo;
  const defaultsMap = await getContaDefaults([...new Set(agendas.map(({ emprestimo }) => emprestimo.contaId))]);

  for (const { emprestimo, instanciaId, mensagemCustom, diasLembrete, updatedAt } of agendas) {
    if (!instanciaId || !clienteTemWhatsApp(emprestimo.cliente)) continue;
    const { contaId, clienteId, cliente, parcelas } = emprestimo;
    const defaults = resolveContaDefaults(defaultsMap, contaId);
    if (!defaults.enabled || defaults.horaEnvio !== hora) continue;
    const dias = normalizeDiasLembrete(diasLembrete);
    const cotacoes = parcelas.map((parcela) => cotarParcela(parcela, emprestimo, hoje));
    const valor = cotacoes.reduce((total, item) => total + item.totalCentavos, 0) / 100;

    for (const [indice, parcela] of parcelas.entries()) {
      const offset = differenceInCalendarDays(diaHoje, parseISO(diaLocal(parcela.vencimento)));
      if (!dias.includes(offset)) continue;
      resumo.checked += 1;
      let reservaId: number | undefined;
      try {
        // Mesmo padrão de Inadimplência: reserva antes do envio para impedir duplicatas no cron.
        const reserva = await prisma.emprestimoLembreteEnviado.create({
          data: { parcelaId: parcela.id, diaOffset: offset, dataReferencia: parcela.vencimento }, select: { id: true },
        });
        reservaId = reserva.id;
        const elegivel = await prisma.emprestimoParcela.findFirst({
          where: {
            id: parcela.id, recebidoEm: null,
            emprestimo: { contaId, lembrete: { ativo: true, updatedAt, instanciaId } },
          },
          select: { id: true },
        });
        if (!elegivel) {
          await prisma.emprestimoLembreteEnviado.deleteMany({ where: { id: reservaId } });
          resumo.skipped += 1;
          continue;
        }
        await dispatchClienteReminder("WHATSAPP", {
          contaId, clienteId, instanciaId,
          mensagem: buildMensagemInadimplencia({
            clienteNome: cliente.nome, descricao: `Empréstimo #${emprestimo.id}`, valor,
            valorParcela: cotacoes[indice].totalCentavos / 100, dueDate: parcela.vencimento,
            offset, parcelaNumero: parcela.numero, totalParcelas: emprestimo._count.parcelas,
            mensagemCustom, mensagemPadraoConta: defaults.defaultMensagem,
          }),
        });
        resumo.sent += 1;
      } catch (error) {
        if (reservaId === undefined && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          resumo.skipped += 1;
          continue;
        }
        if (reservaId !== undefined) await prisma.emprestimoLembreteEnviado.deleteMany({ where: { id: reservaId } });
        resumo.failed += 1;
        resumo.errors.push(`parcela:${parcela.id} offset:${offset} - ${(error as Error)?.message || "Falha desconhecida"}`);
      }
    }
  }
  return resumo;
}
