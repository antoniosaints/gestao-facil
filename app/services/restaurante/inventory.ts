import Decimal from "decimal.js";
import type { Prisma } from "../../../generated";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { assertAvailableAndDecrement } from "../loja/lojaInventoryService";

type Transaction = Prisma.TransactionClient;

type SelectionSnapshot = {
  produtoId?: number | null;
};

export class RestauranteEstoqueError extends Error {
  constructor(public code: "invalid_stock_quantity" | "stock_output_disabled", message: string) {
    super(message);
  }
}

type StockItem = { id: number; produtoId: number | null; quantidade: Decimal | number | string; selecoesSnapshotJson: Prisma.JsonValue | null };
type StockProduct = { id: number; nome: string; controlaEstoque: boolean | null; saidas: boolean | null };
export type RestaurantStockRequirement = { pedidoItemId: number; produtoId: number; quantidade: number; main: boolean };

function selectionProductIds(value: Prisma.JsonValue | null): number[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const id = Number((entry as SelectionSnapshot).produtoId);
    return Number.isInteger(id) && id > 0 ? [id] : [];
  });
}

export function buildRestaurantStockRequirements(items: StockItem[], products: StockProduct[]) {
  const byId = new Map(products.map((product) => [product.id, product]));
  const requirements = new Map<string, RestaurantStockRequirement>();
  for (const item of items) {
    const quantity = Number(item.quantidade);
    const linkedProducts = [item.produtoId, ...selectionProductIds(item.selecoesSnapshotJson)].filter((id): id is number => id !== null && Number.isInteger(id) && id > 0);
    for (const produtoId of linkedProducts) {
      const product = byId.get(produtoId);
      if (!product?.controlaEstoque) continue;
      if (!product.saidas) throw new RestauranteEstoqueError("stock_output_disabled", `${product.nome} nao permite saida de estoque.`);
      if (!Number.isInteger(quantity)) {
        throw new RestauranteEstoqueError("invalid_stock_quantity", `${product.nome} controla estoque por unidade e exige quantidade inteira.`);
      }
      const key = `${item.id}:${produtoId}`;
      const current = requirements.get(key);
      requirements.set(key, {
        pedidoItemId: item.id,
        produtoId,
        quantidade: (current?.quantidade || 0) + quantity,
        main: Boolean(current?.main || produtoId === item.produtoId),
      });
    }
  }
  return [...requirements.values()];
}

export async function debitRestaurantOrderStock(tx: Transaction, contaId: number, pedidoId: number) {
  const alreadyDebited = await tx.restaurantePedidoEstoque.count({ where: { contaId, pedidoId } });
  if (alreadyDebited) return;

  const items = await tx.restaurantePedidoItem.findMany({
    where: { pedidoId, Pedido: { contaId } },
    select: { id: true, produtoId: true, quantidade: true, selecoesSnapshotJson: true },
    orderBy: { id: "asc" },
  });
  const productIds = [...new Set(items.flatMap((item) => [item.produtoId, ...selectionProductIds(item.selecoesSnapshotJson)]).filter((id): id is number => id !== null && Number.isInteger(id) && id > 0))];
  const products = await tx.produto.findMany({
    where: { contaId, id: { in: productIds } },
    select: { id: true, nome: true, controlaEstoque: true, saidas: true, precoCompra: true },
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  const requirements = buildRestaurantStockRequirements(items, products);

  const totals = new Map<number, number>();
  for (const requirement of requirements) {
    totals.set(requirement.produtoId, (totals.get(requirement.produtoId) || 0) + requirement.quantidade);
  }
  for (const [produtoId, quantidade] of [...totals.entries()].sort(([a], [b]) => a - b)) {
    await assertAvailableAndDecrement(tx, contaId, produtoId, quantidade);
  }

  for (const requirement of requirements.sort((a, b) => a.produtoId - b.produtoId || a.pedidoItemId - b.pedidoItemId)) {
    const product = byId.get(requirement.produtoId)!;
    const movement = await tx.movimentacoesEstoque.create({
      data: {
        Uid: gerarIdUnicoComMetaFinal("MOV"),
        contaId,
        produtoId: requirement.produtoId,
        quantidade: requirement.quantidade,
        custo: new Decimal(product.precoCompra || 0),
        status: "CONCLUIDO",
        tipo: "SAIDA",
      },
    });
    await tx.restaurantePedidoEstoque.create({
      data: {
        contaId,
        pedidoId,
        pedidoItemId: requirement.pedidoItemId,
        produtoId: requirement.produtoId,
        quantidade: requirement.quantidade,
        movimentacaoSaidaId: movement.id,
      },
    });
    if (requirement.main) {
      await tx.restaurantePedidoItem.update({
        where: { id: requirement.pedidoItemId },
        data: { estoqueDebitado: true, quantidadeDebitada: requirement.quantidade },
      });
    }
  }
}

export async function returnRestaurantOrderStock(tx: Transaction, contaId: number, pedidoId: number) {
  const debits = await tx.restaurantePedidoEstoque.findMany({
    where: { contaId, pedidoId, status: "DEBITADO" },
    include: { Produto: { select: { precoCompra: true } } },
    orderBy: [{ produtoId: "asc" }, { id: "asc" }],
  });
  for (const debit of debits) {
    const claimed = await tx.restaurantePedidoEstoque.updateMany({
      where: { id: debit.id, status: "DEBITADO" },
      data: { status: "DEVOLVIDO", devolvidoAt: new Date() },
    });
    if (!claimed.count) continue;
    await tx.produto.update({ where: { id: debit.produtoId }, data: { estoque: { increment: debit.quantidade } } });
    const movement = await tx.movimentacoesEstoque.create({
      data: {
        Uid: gerarIdUnicoComMetaFinal("MOV"),
        contaId,
        produtoId: debit.produtoId,
        quantidade: debit.quantidade,
        custo: new Decimal(debit.Produto.precoCompra || 0),
        status: "CONCLUIDO",
        tipo: "ENTRADA",
      },
    });
    await tx.restaurantePedidoEstoque.update({
      where: { id: debit.id },
      data: { movimentacaoDevolucaoId: movement.id },
    });
  }
  await tx.restaurantePedidoItem.updateMany({
    where: { pedidoId, estoqueDebitado: true },
    data: { estoqueDebitado: false, quantidadeDebitada: 0 },
  });
}
