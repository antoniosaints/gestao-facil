import Decimal from "decimal.js";
import type { Prisma } from "../../../generated";
import { CommerceError } from "./commerceError";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";

type Transaction = Prisma.TransactionClient;
type RequestedItem = { produtoId: number; quantidade: number };

export function calculateAvailableStock(physical: number, reserved: number) {
  return Math.max(0, physical - reserved);
}

export async function getReservedQuantity(tx: Transaction, contaId: number, produtoId: number) {
  const result = await tx.lojaReservaEstoque.aggregate({
    where: { contaId, produtoId, status: { in: ["ATIVA", "CONFIRMADA"] } },
    _sum: { quantidade: true },
  });
  return result._sum.quantidade ?? 0;
}

async function lockProducts(tx: Transaction, contaId: number, productIds: number[]) {
  const ids = [...new Set(productIds)].sort((a, b) => a - b);
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  await tx.$queryRawUnsafe(
    `SELECT id FROM Produto WHERE contaId = ? AND id IN (${placeholders}) ORDER BY id FOR UPDATE`,
    contaId,
    ...ids,
  );
}

export async function reserveOrderStock(
  tx: Transaction,
  contaId: number,
  pedidoId: number,
  items: Array<RequestedItem & { pedidoItemId: number; controlaEstoque: boolean }>,
  expiresAt: Date,
) {
  const controlled = items.filter((item) => item.controlaEstoque).sort((a, b) => a.produtoId - b.produtoId);
  await lockProducts(tx, contaId, controlled.map((item) => item.produtoId));

  for (const item of controlled) {
    const product = await tx.produto.findFirst({
      where: { id: item.produtoId, contaId },
      select: { id: true, nome: true, estoque: true },
    });
    if (!product) throw new CommerceError("not_found", "Produto não encontrado");
    const reserved = await getReservedQuantity(tx, contaId, product.id);
    const available = calculateAvailableStock(product.estoque, reserved);
    if (available < item.quantidade) {
      throw new CommerceError("stock_unavailable", `${product.nome} não possui estoque suficiente`, {
        produtoId: product.id,
        requested: item.quantidade,
        available,
      });
    }
    await tx.lojaReservaEstoque.create({
      data: {
        contaId,
        pedidoId,
        pedidoItemId: item.pedidoItemId,
        produtoId: item.produtoId,
        quantidade: item.quantidade,
        expiresAt,
      },
    });
  }
}

export async function assertAvailableAndDecrement(
  tx: Transaction,
  contaId: number,
  produtoId: number,
  quantidade: number,
) {
  await lockProducts(tx, contaId, [produtoId]);
  const product = await tx.produto.findFirstOrThrow({ where: { id: produtoId, contaId } });
  const reserved = await getReservedQuantity(tx, contaId, produtoId);
  const available = calculateAvailableStock(product.estoque, reserved);
  if (available < quantidade) {
    throw new CommerceError("stock_unavailable", `${product.nome} possui unidades reservadas para a loja`, {
      produtoId,
      physical: product.estoque,
      reserved,
      available,
      requested: quantidade,
    });
  }
  return tx.produto.update({ where: { id: produtoId }, data: { estoque: { decrement: quantidade } } });
}

export async function consumeOrderReservations(tx: Transaction, contaId: number, pedidoId: number, vendaId: number) {
  const reservations = await tx.lojaReservaEstoque.findMany({
    where: { contaId, pedidoId, status: { in: ["ATIVA", "CONFIRMADA"] } },
    include: { PedidoItem: true },
    orderBy: { produtoId: "asc" },
  });
  await lockProducts(tx, contaId, reservations.map((reservation) => reservation.produtoId));

  for (const reservation of reservations) {
    const product = await tx.produto.findFirstOrThrow({ where: { id: reservation.produtoId, contaId } });
    if (product.estoque < reservation.quantidade) {
      throw new CommerceError("stock_unavailable", `Estoque físico inconsistente para ${product.nome}`);
    }
    await tx.produto.update({
      where: { id: product.id },
      data: { estoque: { decrement: reservation.quantidade } },
    });
    const movement = await tx.movimentacoesEstoque.create({
      data: {
        Uid: gerarIdUnicoComMetaFinal("MOV"),
        contaId,
        vendaId,
        reservaLojaId: reservation.id,
        produtoId: reservation.produtoId,
        quantidade: reservation.quantidade,
        custo: new Decimal(reservation.PedidoItem.precoUnitarioSnapshot),
        status: "CONCLUIDO",
        tipo: "SAIDA",
      },
    });
    await tx.lojaReservaEstoque.update({
      where: { id: reservation.id },
      data: { status: "CONSUMIDA", consumedAt: new Date(), expiresAt: null },
    });
    void movement;
  }
}

export async function releaseOrderReservations(
  tx: Transaction,
  contaId: number,
  pedidoId: number,
  status: "LIBERADA" | "EXPIRADA" = "LIBERADA",
) {
  return tx.lojaReservaEstoque.updateMany({
    where: { contaId, pedidoId, status: { in: ["ATIVA", "CONFIRMADA"] } },
    data: { status, releasedAt: new Date(), expiresAt: null },
  });
}
