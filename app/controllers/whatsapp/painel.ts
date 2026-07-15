import { Request, Response } from "express";
import dayjs from "dayjs";
import {
  WhatsAppConversaEventoTipo,
  WhatsAppConversaStatus,
  WhatsAppMensagemDirecao,
  WhatsAppMensagemOrigem,
} from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { calcularDuracaoMs } from "../../services/whatsapp/whatsappAtendimento";

function getPeriodo(req: Request) {
  const { inicio, fim } = req.query;
  const start = inicio ? dayjs(inicio as string) : dayjs().startOf("month");
  const end = fim ? dayjs(fim as string) : dayjs().endOf("month");
  return { start: start.toDate(), end: end.toDate() };
}

function getContaId(req: Request) {
  return Number(getCustomRequest(req).customData.contaId);
}

function delta(atual: number, anterior: number) {
  if (!anterior) return atual > 0 ? 100 : 0;
  return ((atual - anterior) / anterior) * 100;
}

function metrica(atual: number, anterior: number) {
  return { atual, anterior, delta: delta(atual, anterior) };
}

// Média em ms dos intervalos fechados pelos eventos. Eventos sem referência (a conversa nunca
// passou pela fase anterior) ficam de fora em vez de entrar como zero e puxar a média para baixo.
function mediaDuracaoMs(eventos: { referenciaEm: Date | null; createdAt: Date }[]) {
  const duracoes = eventos
    .map((e) => calcularDuracaoMs(e.referenciaEm, e.createdAt))
    .filter((ms): ms is number => ms !== null);
  if (!duracoes.length) return 0;
  return Math.round(duracoes.reduce((acc, ms) => acc + ms, 0) / duracoes.length);
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Painel de atendimento consolidado: estado da fila agora, KPIs do período com comparação ao
 * período anterior, volume por origem, ranking de produtividade por atendente e a fila detalhada.
 *
 * Os KPIs de tempo e de produtividade só existem para dados posteriores à instrumentação
 * (WhatsAppConversaEvento e WhatsAppMensagem.origem). Mensagens antigas têm origem nula e ficam
 * fora das contagens por origem — melhor não contar do que atribuir à pessoa errada, já que
 * resposta de agente de IA e de atendente são ambas SAIDA.
 */
export async function getPainelAtendimento(req: Request, res: Response): Promise<any> {
  try {
    const contaId = getContaId(req);
    const { start, end } = getPeriodo(req);
    const agora = new Date();
    const durationMs = Math.max(0, end.getTime() - start.getTime());
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - durationMs);

    const periodo = { gte: start, lte: end };
    const periodoAnterior = { gte: prevStart, lte: prevEnd };

    const [
      porStatus,
      agregadoNaoLidas,
      filaAtual,
      eventosPeriodo,
      eventosAnterior,
      mensagensPorOrigem,
      mensagensPorOrigemAnterior,
      mensagensPeriodo,
      produtividadeMensagens,
      atendentes,
    ] = await Promise.all([
      prisma.whatsAppConversa.groupBy({
        by: ["status"],
        where: { contaId },
        _count: { _all: true },
      }),
      prisma.whatsAppConversa.aggregate({
        where: { contaId },
        _sum: { naoLidas: true },
      }),
      // Fila atual detalhada: quem está esperando e há quanto tempo.
      prisma.whatsAppConversa.findMany({
        where: { contaId, status: WhatsAppConversaStatus.PENDENTE },
        select: {
          id: true,
          telefone: true,
          fila: true,
          setor: true,
          naoLidas: true,
          filaDesde: true,
          ultimaMensagem: true,
          ultimaInteracaoEm: true,
          Contato: { select: { nome: true } },
          Instancia: { select: { id: true, nome: true } },
        },
        orderBy: [{ filaDesde: "asc" }, { ultimaInteracaoEm: "asc" }],
        take: 50,
      }),
      prisma.whatsAppConversaEvento.findMany({
        where: { contaId, createdAt: periodo },
        select: { tipo: true, usuarioId: true, referenciaEm: true, createdAt: true },
      }),
      prisma.whatsAppConversaEvento.findMany({
        where: { contaId, createdAt: periodoAnterior },
        select: { tipo: true, referenciaEm: true, createdAt: true },
      }),
      prisma.whatsAppMensagem.groupBy({
        by: ["origem"],
        where: { contaId, createdAt: periodo },
        _count: { _all: true },
      }),
      prisma.whatsAppMensagem.groupBy({
        by: ["origem"],
        where: { contaId, createdAt: periodoAnterior },
        _count: { _all: true },
      }),
      // Série de volume: só as datas e a direção, para montar os buckets.
      prisma.whatsAppMensagem.findMany({
        where: { contaId, createdAt: periodo },
        select: { direcao: true, createdAt: true },
      }),
      prisma.whatsAppMensagem.groupBy({
        by: ["usuarioId"],
        where: { contaId, createdAt: periodo, origem: WhatsAppMensagemOrigem.ATENDENTE },
        _count: { _all: true },
      }),
      prisma.usuarios.findMany({ where: { contaId }, select: { id: true, nome: true } }),
    ]);

    const contarStatus = (status: WhatsAppConversaStatus) =>
      porStatus.find((s) => s.status === status)?._count._all ?? 0;

    const naFila = contarStatus(WhatsAppConversaStatus.PENDENTE);
    const emAtendimento = contarStatus(WhatsAppConversaStatus.ABERTA);
    const finalizadasTotal = contarStatus(WhatsAppConversaStatus.FINALIZADA);

    // Espera da fila agora: a conversa mais antiga ainda aguardando.
    const esperasAtuais = filaAtual
      .map((c) => calcularDuracaoMs(c.filaDesde, agora))
      .filter((ms): ms is number => ms !== null);
    const esperaMaiorAtual = esperasAtuais.length ? Math.max(...esperasAtuais) : 0;

    const porTipo = <T extends { tipo: WhatsAppConversaEventoTipo }>(eventos: T[], tipo: WhatsAppConversaEventoTipo) =>
      eventos.filter((e) => e.tipo === tipo);

    const enfileiradas = porTipo(eventosPeriodo, WhatsAppConversaEventoTipo.ENFILEIRADA);
    const assumidas = porTipo(eventosPeriodo, WhatsAppConversaEventoTipo.ASSUMIDA);
    const finalizadas = porTipo(eventosPeriodo, WhatsAppConversaEventoTipo.FINALIZADA);
    const assumidasAnterior = porTipo(eventosAnterior, WhatsAppConversaEventoTipo.ASSUMIDA);
    const finalizadasAnterior = porTipo(eventosAnterior, WhatsAppConversaEventoTipo.FINALIZADA);

    const contarOrigem = (
      grupos: { origem: WhatsAppMensagemOrigem | null; _count: { _all: number } }[],
      origem: WhatsAppMensagemOrigem,
    ) => grupos.find((g) => g.origem === origem)?._count._all ?? 0;

    const recebidas = contarOrigem(mensagensPorOrigem, WhatsAppMensagemOrigem.CONTATO);
    const recebidasAnterior = contarOrigem(mensagensPorOrigemAnterior, WhatsAppMensagemOrigem.CONTATO);
    const porAtendente = contarOrigem(mensagensPorOrigem, WhatsAppMensagemOrigem.ATENDENTE);
    const porAtendenteAnterior = contarOrigem(mensagensPorOrigemAnterior, WhatsAppMensagemOrigem.ATENDENTE);
    const porIa = contarOrigem(mensagensPorOrigem, WhatsAppMensagemOrigem.AGENTE_IA);
    const porIaAnterior = contarOrigem(mensagensPorOrigemAnterior, WhatsAppMensagemOrigem.AGENTE_IA);
    const porDispositivo = contarOrigem(mensagensPorOrigem, WhatsAppMensagemOrigem.DISPOSITIVO);
    const semOrigem = mensagensPorOrigem.find((g) => g.origem === null)?._count._all ?? 0;

    // Série de volume (por dia até 92 dias, senão por mês), espelhando o painel de produtos.
    const dayMs = 86_400_000;
    const diffDays = Math.max(1, Math.round(durationMs / dayMs) + 1);
    const usarDia = diffDays <= 92;
    const chave = (d: Date) =>
      usarDia ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}` : `${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

    const buckets = new Map<string, { recebidas: number; enviadas: number }>();
    if (usarDia) {
      for (let i = 0; i < diffDays; i++) {
        buckets.set(chave(new Date(start.getTime() + i * dayMs)), { recebidas: 0, enviadas: 0 });
      }
    }
    for (const m of mensagensPeriodo) {
      const key = chave(new Date(m.createdAt));
      const atual = buckets.get(key) || { recebidas: 0, enviadas: 0 };
      if (m.direcao === WhatsAppMensagemDirecao.ENTRADA) atual.recebidas += 1;
      else atual.enviadas += 1;
      buckets.set(key, atual);
    }

    // Produtividade: atendimentos assumidos/finalizados e mensagens enviadas por atendente.
    const nomePorId = new Map(atendentes.map((u) => [u.id, u.nome]));
    const produtividadeMap = new Map<
      number,
      { atendenteId: number; nome: string; assumidas: number; finalizadas: number; mensagens: number }
    >();
    const linha = (usuarioId: number) => {
      const existente = produtividadeMap.get(usuarioId);
      if (existente) return existente;
      const nova = {
        atendenteId: usuarioId,
        nome: nomePorId.get(usuarioId) || "Desconhecido",
        assumidas: 0,
        finalizadas: 0,
        mensagens: 0,
      };
      produtividadeMap.set(usuarioId, nova);
      return nova;
    };
    for (const e of assumidas) if (e.usuarioId) linha(e.usuarioId).assumidas += 1;
    for (const e of finalizadas) if (e.usuarioId) linha(e.usuarioId).finalizadas += 1;
    for (const g of produtividadeMensagens) if (g.usuarioId) linha(g.usuarioId).mensagens += g._count._all;

    const produtividade = [...produtividadeMap.values()].sort(
      (a, b) => b.assumidas + b.mensagens - (a.assumidas + a.mensagens),
    );

    return res.json({
      periodo: { inicio: start, fim: end, anterior: { inicio: prevStart, fim: prevEnd } },
      // Estado agora, independente do período selecionado.
      agora: {
        naFila,
        emAtendimento,
        finalizadas: finalizadasTotal,
        naoLidas: agregadoNaoLidas._sum.naoLidas ?? 0,
        esperaMaiorMs: esperaMaiorAtual,
      },
      kpis: {
        novasNaFila: metrica(enfileiradas.length, porTipo(eventosAnterior, WhatsAppConversaEventoTipo.ENFILEIRADA).length),
        atendimentosAssumidos: metrica(assumidas.length, assumidasAnterior.length),
        atendimentosFinalizados: metrica(finalizadas.length, finalizadasAnterior.length),
        tempoMedioEsperaMs: metrica(mediaDuracaoMs(assumidas), mediaDuracaoMs(assumidasAnterior)),
        tempoMedioResolucaoMs: metrica(mediaDuracaoMs(finalizadas), mediaDuracaoMs(finalizadasAnterior)),
        mensagensRecebidas: metrica(recebidas, recebidasAnterior),
        respostasAtendente: metrica(porAtendente, porAtendenteAnterior),
        respostasIa: metrica(porIa, porIaAnterior),
      },
      serieVolume: {
        labels: [...buckets.keys()],
        recebidas: [...buckets.values()].map((b) => b.recebidas),
        enviadas: [...buckets.values()].map((b) => b.enviadas),
      },
      distribuicaoStatus: {
        labels: ["Na fila", "Em atendimento", "Finalizadas"],
        data: [naFila, emAtendimento, finalizadasTotal],
      },
      distribuicaoOrigem: {
        labels: ["Cliente", "Atendente", "Agente IA", "Aparelho"],
        data: [recebidas, porAtendente, porIa, porDispositivo],
        // Mensagens anteriores à instrumentação: exibidas à parte para não fingir precisão.
        semOrigem,
      },
      produtividade,
      filaAtual: filaAtual.map((c) => ({
        conversaId: c.id,
        contato: c.Contato?.nome || c.telefone,
        telefone: c.telefone,
        instancia: c.Instancia?.nome ?? null,
        fila: c.fila,
        setor: c.setor,
        naoLidas: c.naoLidas,
        ultimaMensagem: c.ultimaMensagem,
        esperandoMs: calcularDuracaoMs(c.filaDesde, agora),
      })),
    });
  } catch (error) {
    handleError(res, error);
  }
}
