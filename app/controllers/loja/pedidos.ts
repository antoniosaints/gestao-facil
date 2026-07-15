import type { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";
import { sendCommerceError } from "../../services/loja/commerceError";
import { removeStoreOrder, transitionStoreOrder } from "../../services/loja/lojaOrderService";
import { sendUpdateTable } from "../../hooks/vendas/socket";

export async function listStoreOrders(req: Request, res: Response) {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const where: any = {
      contaId,
      ...(req.query.status ? { status: String(req.query.status) } : {}),
      ...(req.query.channel ? { canal: String(req.query.channel) } : {}),
      ...(req.query.search ? { OR: [{ Uid: { contains: String(req.query.search) } }, { nomeSnapshot: { contains: String(req.query.search) } }, { telefoneSnapshot: { contains: String(req.query.search) } }] } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.lojaPedido.findMany({ where, include: { itens: true, cobrancas: true, Venda: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.lojaPedido.count({ where }),
    ]);
    return res.json({ status: 200, message: "Pedidos encontrados", data, page, totalPages: Math.max(1, Math.ceil(total / limit)), total });
  } catch (error) { return sendCommerceError(res, error); }
}

export async function showStoreOrder(req: Request, res: Response) {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const order = await prisma.lojaPedido.findFirst({ where: { id: Number(req.params.id), contaId }, include: { itens: true, reservas: true, tentativasCheckout: true, cobrancas: true, Venda: { include: { PagamentoVendas: true, MovimentacoesEstoque: true } } } });
    return order ? ResponseHandler(res, "Pedido encontrado", order) : ResponseHandler(res, "Pedido não encontrado", null, 404);
  } catch (error) { return sendCommerceError(res, error); }
}

export async function actOnStoreOrder(req: Request, res: Response) {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const action = req.params.action as "confirmar" | "preparar" | "despachar" | "cancelar" | "concluir";
    if (!["confirmar", "preparar", "despachar", "cancelar", "concluir"].includes(action)) return ResponseHandler(res, "Ação inválida", null, 422);
    const order = await transitionStoreOrder(contaId, Number(req.params.id), action, String(req.header("Idempotency-Key") || ""));
    sendUpdateTable(contaId, { reason: "loja-pedido", orderId: order.id, action });
    return ResponseHandler(res, "Pedido atualizado", order);
  } catch (error) { return sendCommerceError(res, error); }
}

export async function deleteStoreOrder(req: Request, res: Response) {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const result = await removeStoreOrder(contaId, Number(req.params.id));
    sendUpdateTable(contaId, { reason: "loja-pedido", orderId: result.id, action: "excluir" });
    return ResponseHandler(res, "Pedido excluído", result);
  } catch (error) { return sendCommerceError(res, error); }
}
