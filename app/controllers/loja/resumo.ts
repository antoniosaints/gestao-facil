import { Request, Response } from "express";
import Decimal from "decimal.js";
import dayjs from "dayjs";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { LojaPedidoStatus } from "../../../generated";

// Pedidos que ainda exigem ação da operação: entraram e não foram despachados nem encerrados.
const STATUS_EM_ABERTO: LojaPedidoStatus[] = [
  LojaPedidoStatus.RECEBIDO,
  LojaPedidoStatus.CONFIRMADO,
  LojaPedidoStatus.PREPARANDO,
];

// Pedidos que representam venda concretizada. CANCELADO/EXPIRADO/REVISAO ficam de fora do
// faturamento para não inflar o número com pedido que não virou dinheiro.
const STATUS_FATURAVEL: LojaPedidoStatus[] = [
  LojaPedidoStatus.CONFIRMADO,
  LojaPedidoStatus.PREPARANDO,
  LojaPedidoStatus.DESPACHADO,
  LojaPedidoStatus.CONCLUIDO,
];

function getPeriodo(req: Request) {
  const { inicio, fim } = req.query;
  const start = inicio ? dayjs(inicio as string) : dayjs().startOf("month");
  const end = fim ? dayjs(fim as string) : dayjs().endOf("month");
  return { start: start.toDate(), end: end.toDate() };
}

/**
 * Resumo da loja virtual para a dashboard: volume e faturamento do período, mais o que está
 * parado esperando a operação (pedidos em aberto é estado atual, não recorte do período —
 * um pedido do mês passado ainda não despachado continua sendo um problema hoje).
 */
export async function getResumoLoja(req: Request, res: Response): Promise<any> {
  try {
    const contaId = Number(getCustomRequest(req).customData.contaId);
    const { start, end } = getPeriodo(req);

    const [pedidosPeriodo, emAberto] = await Promise.all([
      prisma.lojaPedido.findMany({
        where: { contaId, createdAt: { gte: start, lte: end } },
        select: { status: true, total: true },
      }),
      prisma.lojaPedido.count({ where: { contaId, status: { in: STATUS_EM_ABERTO } } }),
    ]);

    const faturaveis = pedidosPeriodo.filter((p) => STATUS_FATURAVEL.includes(p.status));
    const faturamento = faturaveis.reduce((acc, p) => acc.add(p.total), new Decimal(0));
    const ticketMedio = faturaveis.length ? faturamento.div(faturaveis.length) : new Decimal(0);

    return res.json({
      periodo: { inicio: start, fim: end },
      pedidos: pedidosPeriodo.length,
      pedidosFaturados: faturaveis.length,
      faturamento: faturamento.toNumber(),
      ticketMedio: ticketMedio.toNumber(),
      // Estado atual, independente do período: é o que exige ação.
      emAberto,
      cancelados: pedidosPeriodo.filter((p) => p.status === LojaPedidoStatus.CANCELADO).length,
    });
  } catch (error) {
    handleError(res, error);
  }
}
