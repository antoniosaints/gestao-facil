import { Request, Response } from "express";
import { z } from "zod";

import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { ResponseHandler } from "../../utils/response";
import { prisma } from "../../utils/prisma";
import { formatCurrency, formatDateToPtBR } from "../../utils/formatters";
import { sendFinanceiroUpdated } from "../../hooks/financeiro/socket";
import { enqueueWhatsAppClientMessage } from "../../services/notifications/whatsappNotificationQueueService";
import {
  applyMensagemTemplate,
  computeDueOffset,
  getOffsetLabel,
  MAX_DIA_OFFSET,
  MIN_DIA_OFFSET,
  resolveLembreteSchedule,
} from "../../services/financeiro/inadimplenciaLembretePolicy";
import { buildMensagemInadimplencia } from "../../services/financeiro/inadimplenciaReminderService";
import {
  bulkUpsertLancamentoOverrides,
  getInadimplenciaConfig,
  getInadimplenciaResumo,
  listInadimplencia,
  removeLancamentoLembreteOverride,
  saveInadimplenciaConfig,
  upsertClienteLembreteConfig,
  upsertLancamentoLembreteOverride,
  type InadimplenciaStatusFiltro,
  type LembreteConfigPayload,
} from "../../services/financeiro/inadimplenciaService";

const diaSchema = z.coerce.number().int().min(MIN_DIA_OFFSET).max(MAX_DIA_OFFSET);

const configSchema = z.object({
  ativo: z.boolean().default(true),
  dias: z.array(diaSchema).default([]),
  canalWhatsapp: z.boolean().default(true),
  canalEmail: z.boolean().default(false),
  canalSms: z.boolean().default(false),
  mensagemCustom: z.string().trim().max(1000).optional().nullable(),
});

const bulkSchema = configSchema.extend({
  lancamentoIds: z.array(z.coerce.number().int().positive()).min(1),
});

const enviarAgoraSchema = z.object({
  mensagem: z.string().trim().max(1000).optional().nullable(),
  parcelaId: z.coerce.number().int().positive().optional(),
});

const configSistemaSchema = z.object({
  horaEnvio: z.coerce.number().int().min(0).max(23),
  dias: z.array(diaSchema).default([]),
  mensagem: z.string().trim().max(1000).optional().nullable(),
});

const CONFIG_SELECT = {
  ativo: true,
  diasLembrete: true,
  canalWhatsapp: true,
  canalEmail: true,
  canalSms: true,
  mensagemCustom: true,
} as const;

function toConfigInput(row: {
  ativo: boolean;
  diasLembrete: unknown;
  canalWhatsapp: boolean;
  canalEmail: boolean;
  canalSms: boolean;
  mensagemCustom: string | null;
} | null | undefined) {
  if (!row) return null;
  return {
    ativo: row.ativo,
    diasLembrete: row.diasLembrete,
    canalWhatsapp: row.canalWhatsapp,
    canalEmail: row.canalEmail,
    canalSms: row.canalSms,
    mensagemCustom: row.mensagemCustom,
  };
}

function toPayload(parsed: z.infer<typeof configSchema>): LembreteConfigPayload {
  return {
    ativo: parsed.ativo,
    dias: parsed.dias,
    canalWhatsapp: parsed.canalWhatsapp,
    canalEmail: parsed.canalEmail,
    canalSms: parsed.canalSms,
    mensagemCustom: parsed.mensagemCustom ?? null,
  };
}

export async function getInadimplenciaLista(req: Request, res: Response): Promise<any> {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const status = String(req.query.status || "TODOS") as InadimplenciaStatusFiltro;

    const result = await listInadimplencia(contaId, {
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      status: ["TODOS", "ATRASADOS", "A_VENCER"].includes(status) ? status : "TODOS",
      clienteId: req.query.clienteId ? Number(req.query.clienteId) : null,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 10,
    });

    return res.json(result);
  } catch (error) {
    return handleError(res, error);
  }
}

export async function getInadimplenciaResumoController(req: Request, res: Response): Promise<any> {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const resumo = await getInadimplenciaResumo(contaId);
    return ResponseHandler(res, "OK", resumo, 200);
  } catch (error) {
    return handleError(res, error);
  }
}

export async function getInadimplenciaConfigController(req: Request, res: Response): Promise<any> {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const config = await getInadimplenciaConfig(contaId);
    return ResponseHandler(res, "OK", config, 200);
  } catch (error) {
    return handleError(res, error);
  }
}

export async function salvarInadimplenciaConfig(req: Request, res: Response): Promise<any> {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const parsed = configSistemaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || "Dados inválidos." });
    }

    const config = await saveInadimplenciaConfig(contaId, {
      horaEnvio: parsed.data.horaEnvio,
      dias: parsed.data.dias,
      mensagem: parsed.data.mensagem ?? null,
    });
    sendFinanceiroUpdated(contaId, { reason: "inadimplencia-config-padrao-atualizada" });

    return ResponseHandler(res, "Configurações padrão salvas.", config, 200);
  } catch (error) {
    return handleError(res, error);
  }
}

export async function salvarLembreteCliente(req: Request, res: Response): Promise<any> {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const clienteId = Number(req.params.clienteId);
    if (!Number.isInteger(clienteId) || clienteId <= 0) {
      return res.status(400).json({ message: "Cliente inválido." });
    }

    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || "Dados inválidos." });
    }

    await upsertClienteLembreteConfig(contaId, clienteId, toPayload(parsed.data));
    sendFinanceiroUpdated(contaId, { reason: "inadimplencia-lembrete-cliente-atualizado", clienteId });

    return ResponseHandler(res, "Agenda padrão do cliente atualizada.", null, 200);
  } catch (error) {
    return handleError(res, error);
  }
}

export async function salvarLembreteLancamento(req: Request, res: Response): Promise<any> {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const lancamentoId = Number(req.params.id);
    if (!Number.isInteger(lancamentoId) || lancamentoId <= 0) {
      return res.status(400).json({ message: "Lançamento inválido." });
    }

    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || "Dados inválidos." });
    }

    await upsertLancamentoLembreteOverride(contaId, lancamentoId, toPayload(parsed.data));
    sendFinanceiroUpdated(contaId, { reason: "inadimplencia-lembrete-lancamento-atualizado", lancamentoId });

    return ResponseHandler(res, "Lembrete do lançamento atualizado.", null, 200);
  } catch (error) {
    return handleError(res, error);
  }
}

export async function removerLembreteLancamento(req: Request, res: Response): Promise<any> {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const lancamentoId = Number(req.params.id);
    if (!Number.isInteger(lancamentoId) || lancamentoId <= 0) {
      return res.status(400).json({ message: "Lançamento inválido." });
    }

    const result = await removeLancamentoLembreteOverride(contaId, lancamentoId);
    sendFinanceiroUpdated(contaId, { reason: "inadimplencia-lembrete-lancamento-removido", lancamentoId });

    return ResponseHandler(
      res,
      result.removed ? "Override removido. O lançamento volta a seguir a agenda do cliente." : "Nenhum override para remover.",
      null,
      200,
    );
  } catch (error) {
    return handleError(res, error);
  }
}

export async function salvarLembretesEmMassa(req: Request, res: Response): Promise<any> {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || "Dados inválidos." });
    }

    const { lancamentoIds, ...config } = parsed.data;
    const result = await bulkUpsertLancamentoOverrides(contaId, lancamentoIds, toPayload(config));
    sendFinanceiroUpdated(contaId, { reason: "inadimplencia-lembretes-massa-atualizados" });

    return ResponseHandler(res, `${result.atualizados} lançamento(s) atualizado(s).`, result, 200);
  } catch (error) {
    return handleError(res, error);
  }
}

export async function enviarLembreteAgora(req: Request, res: Response): Promise<any> {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const lancamentoId = Number(req.params.id);
    if (!Number.isInteger(lancamentoId) || lancamentoId <= 0) {
      return res.status(400).json({ message: "Lançamento inválido." });
    }

    const parsed = enviarAgoraSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Mensagem inválida." });
    }

    const lancamento = await prisma.lancamentoFinanceiro.findFirst({
      where: { id: lancamentoId, contaId, tipo: "RECEITA", clienteId: { not: null } },
      select: {
        clienteId: true,
        notificarClienteVencimento: true,
        descricao: true,
        cliente: {
          select: {
            nome: true,
            LembreteConfig: { select: CONFIG_SELECT },
          },
        },
        lembreteCliente: { select: CONFIG_SELECT },
        parcelas: {
          where: { pago: false },
          select: { id: true, valor: true, vencimento: true, numero: true },
          orderBy: { vencimento: "asc" },
        },
      },
    });

    if (!lancamento || !lancamento.clienteId) {
      return res.status(404).json({ message: "Lançamento de receita com cliente não encontrado." });
    }
    if (!lancamento.parcelas.length) {
      return res.status(400).json({ message: "Este lançamento não possui parcelas pendentes." });
    }

    const parcelaSelecionada = parsed.data.parcelaId
      ? lancamento.parcelas.find((parcela) => parcela.id === parsed.data.parcelaId)
      : lancamento.parcelas[0];
    if (!parcelaSelecionada) {
      return res.status(400).json({ message: "A parcela selecionada não está pendente neste lançamento." });
    }

    const mensagemCustom = parsed.data.mensagem?.trim();
    const parametros = await prisma.parametrosConta.findUnique({
      where: { contaId },
      select: {
        inadimplenciaDiasPadrao: true,
        inadimplenciaMensagemPadrao: true,
      },
    });

    if (mensagemCustom) {
      const proxima = parcelaSelecionada;
      const valorPendente = lancamento.parcelas.reduce((acc, p) => acc + Number(p.valor || 0), 0);
      const mensagem = applyMensagemTemplate(mensagemCustom, {
        cliente: lancamento.cliente?.nome || "",
        descricao: lancamento.descricao,
        valor: formatCurrency(valorPendente),
        valorparcela: formatCurrency(Number(proxima.valor || 0)),
        vencimento: formatDateToPtBR(proxima.vencimento),
        parcela: String(proxima.numero),
        totalparcelas: String(lancamento.parcelas.length),
        situacao: getOffsetLabel(computeDueOffset(proxima.vencimento)),
      });
      await enqueueWhatsAppClientMessage(contaId, lancamento.clienteId, mensagem);
    } else {
      const proxima = parcelaSelecionada;
      const valorPendente = lancamento.parcelas.reduce((acc, p) => acc + Number(p.valor || 0), 0);
      const schedule = resolveLembreteSchedule({
        override: toConfigInput(lancamento.lembreteCliente),
        clienteConfig: toConfigInput(lancamento.cliente?.LembreteConfig),
        legacyFlag: lancamento.notificarClienteVencimento,
        defaultDias: parametros?.inadimplenciaDiasPadrao,
      });

      const mensagem = buildMensagemInadimplencia({
        clienteNome: lancamento.cliente?.nome || "",
        descricao: lancamento.descricao,
        valor: valorPendente,
        valorParcela: Number(proxima.valor || 0),
        dueDate: proxima.vencimento,
        offset: computeDueOffset(proxima.vencimento),
        parcelaNumero: proxima.numero,
        totalParcelas: lancamento.parcelas.length,
        mensagemCustom: schedule?.mensagemCustom ?? null,
        mensagemPadraoConta: parametros?.inadimplenciaMensagemPadrao ?? null,
      });

      await enqueueWhatsAppClientMessage(contaId, lancamento.clienteId, mensagem);
    }

    return ResponseHandler(res, "Cobrança enfileirada para envio imediato pelo WhatsApp.", null, 202);
  } catch (error) {
    return handleError(res, error);
  }
}
