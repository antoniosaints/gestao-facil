import { enqueueTicketPrintJobs } from "./printing";

export type ProductionTicketState = "PENDENTE" | "PREPARANDO" | "PRONTO" | "ENTREGUE";

export class ProductionRoutingMissingError extends Error {
  constructor() {
    super("Associe a categoria de todos os itens a um ponto ativo no KDS antes de enviar o pedido.");
    this.name = "ProductionRoutingMissingError";
  }
}

export function deriveOrderProductionState(states: ProductionTicketState[]) {
  if (!states.length) return "PENDENTE" as const;
  if (states.every((state) => state === "ENTREGUE")) return "ENTREGUE" as const;
  if (states.every((state) => state === "PRONTO" || state === "ENTREGUE")) return "PRONTO" as const;
  if (states.some((state) => state === "PREPARANDO" || state === "PRONTO" || state === "ENTREGUE")) {
    return "PREPARANDO" as const;
  }
  return "PENDENTE" as const;
}

export async function dispatchOrderToProduction(
  tx: any,
  contaId: number,
  pedidoId: number,
  options: { requireDestination?: boolean } = {},
) {
  const existing = await tx.restauranteTicketProducao.count({ where: { contaId, pedidoId } });
  if (existing) return false;

  const order = await tx.restaurantePedido.findFirst({
    where: { id: pedidoId, contaId },
    include: { itens: true },
  });
  if (!order) throw new Error("Pedido de restaurante nao encontrado.");

  const productIds = [...new Set(order.itens.map((item: any) => item.produtoId).filter((id: unknown): id is number => Number.isInteger(id) && Number(id) > 0))];
  const products = await tx.produto.findMany({
    where: { contaId, id: { in: productIds } },
    select: { id: true, ProdutoBase: { select: { categoriaId: true } } },
  });
  const categoryByProduct = new Map<number, number | null>(
    products.map((product: any) => [product.id, product.ProdutoBase?.categoriaId ?? null]),
  );
  const catalogItemIds = [...new Set(order.itens.map((item: any) => item.catalogoItemId).filter((id: unknown): id is number => Number.isInteger(id) && Number(id) > 0))];
  const catalogItems = await tx.restauranteCatalogoItem.findMany({
    where: { contaId, id: { in: catalogItemIds } },
    select: { id: true, categoriaId: true },
  });
  const categoryByCatalogItem = new Map<number, number | null>(
    catalogItems.map((item: any) => [item.id, item.categoriaId ?? null]),
  );
  const categoryForItem = (item: any) => categoryByCatalogItem.get(item.catalogoItemId) ?? categoryByProduct.get(item.produtoId) ?? null;
  const categoryIds = [...new Set(order.itens.map(categoryForItem).filter(Boolean))] as number[];
  const routes = categoryIds.length
    ? await tx.restauranteRoteamentoProducao.findMany({
        where: { categoriaId: { in: categoryIds }, Ponto: { contaId, ativo: true } },
        include: { Ponto: true },
      })
    : [];

  const routesByCategory = new Map<number, any[]>();
  for (const route of routes) {
    const current = routesByCategory.get(route.categoriaId) || [];
    current.push(route);
    routesByCategory.set(route.categoriaId, current);
  }

  const grouped = new Map<number, { obrigatorio: boolean; itemIds: number[] }>();
  for (const item of order.itens) {
    const categoryId = categoryForItem(item);
    const itemRoutes = categoryId ? routesByCategory.get(categoryId) || [] : [];
    for (const route of itemRoutes) {
      const current = grouped.get(route.pontoId) || { obrigatorio: false, itemIds: [] };
      current.obrigatorio ||= route.obrigatorio;
      current.itemIds.push(item.id);
      grouped.set(route.pontoId, current);
    }
  }

  if (options.requireDestination) {
    const routedItemIds = new Set([...grouped.values()].flatMap((group) => group.itemIds));
    if (order.itens.some((item: any) => !routedItemIds.has(item.id))) {
      throw new ProductionRoutingMissingError();
    }
  }

  for (const [pontoId, group] of grouped) {
    const ticket = await tx.restauranteTicketProducao.create({
      data: {
        contaId,
        pedidoId,
        pontoId,
        obrigatorio: group.obrigatorio,
        itens: {
          create: order.itens
            .filter((item: any) => group.itemIds.includes(item.id))
            .map((item: any) => ({
              pedidoItemId: item.id,
              quantidade: item.quantidade,
              observacao: item.observacao,
            })),
        },
      },
    });
    await enqueueTicketPrintJobs(tx, contaId, ticket.id);
  }
  return grouped.size > 0;
}

export async function syncOrderProductionState(tx: any, contaId: number, pedidoId: number) {
  const tickets = await tx.restauranteTicketProducao.findMany({
    where: { contaId, pedidoId, obrigatorio: true },
    select: { status: true },
  });
  const production = deriveOrderProductionState(tickets.map((ticket: any) => ticket.status));
  const order = await tx.restaurantePedido.findFirst({
    where: { id: pedidoId, contaId },
    select: { emPreparoAt: true, prontoAt: true },
  });
  const data: any = { producaoStatus: production, version: { increment: 1 } };
  if (production === "PREPARANDO") {
    data.status = "EM_PREPARO";
    if (!order?.emPreparoAt) data.emPreparoAt = new Date();
  }
  if (production === "PRONTO" || production === "ENTREGUE") {
    data.status = "PRONTO";
    if (!order?.prontoAt) data.prontoAt = new Date();
  }
  await tx.restaurantePedido.updateMany({
    where: { id: pedidoId, contaId, status: { notIn: ["CONCLUIDO", "CANCELADO"] } },
    data,
  });
  return production;
}
