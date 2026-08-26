import { normalizeClienteWhatsappPhone } from "../clientes/clienteWhatsappPolicy";

type Db = any;

export type RestauranteFidelidadeProgramaInput = {
  ativo: boolean;
  pedidosMeta: number;
  categoriaIds: number[];
  catalogoItemIds: number[];
  premioCatalogoItemId: number | null;
  descontoPercentual: number;
  version?: number;
};

export function normalizeFidelityIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

export function normalizeFidelityPhone(phone?: string | null) {
  return normalizeClienteWhatsappPhone(phone || "") || null;
}

/**
 * Devolve apenas as recompensas que este pedido havia reservado. Mantemos a
 * operação isolada para que o cancelamento nunca libere saldo de outra
 * promoção — nem em pedidos antigos com JSON incompleto.
 */
export async function restoreReservedFidelityRewards(tx: Db, contaId: number, phone: string | null | undefined, reservedProgramIds: unknown) {
  const programaIds = normalizeFidelityIds(reservedProgramIds);
  const telefoneNormalizado = normalizeFidelityPhone(phone);
  if (!programaIds.length || !telefoneNormalizado) return false;
  const restored = await tx.restauranteFidelidadeProgresso.updateMany({
    where: { contaId, telefoneNormalizado, programaId: { in: programaIds } },
    data: { recompensasDisponiveis: { increment: 1 } },
  });
  return restored.count > 0;
}

export function publicFidelity(program: any, progress?: any | null) {
  if (!program?.ativo || !program.premioCatalogoItemId) return null;
  return {
    id: program.id,
    ativo: true,
    pedidosMeta: program.pedidosMeta,
    categoriaIds: normalizeFidelityIds(program.categoriaIdsJson),
    catalogoItemIds: normalizeFidelityIds(program.catalogoItemIdsJson),
    descontoPercentual: Number(program.descontoPercentual),
    premio: program.PremioCatalogoItem ? {
      catalogoItemId: program.PremioCatalogoItem.id,
      nome: program.PremioCatalogoItem.nomePublico || program.PremioCatalogoItem.Produto?.nome || "Item do cardapio",
      imagem: program.PremioCatalogoItem.imagem || program.PremioCatalogoItem.Produto?.imagem || null,
    } : null,
    progresso: progress ? {
      itensElegiveis: progress.pedidosElegiveis,
      pedidosMeta: program.pedidosMeta,
      recompensasDisponiveis: progress.recompensasDisponiveis,
    } : null,
  };
}

export function publicFidelities(entries: Array<{ program: any; progress?: any | null }>) {
  return entries
    .map(({ program, progress }) => publicFidelity(program, progress))
    .filter(Boolean);
}

/** Recompensas utilizáveis no carrinho, uma vez para cada item-premio. */
export function availableFidelityRewards(fidelity: { programs: Array<{ program: any; progress?: any | null }> }, snapshots: any[]) {
  const rewardedItemIds = new Set<number>();
  return fidelity.programs.flatMap(({ program, progress }) => {
    if (!program.ativo || !program.premioCatalogoItemId || !progress?.recompensasDisponiveis) return [];
    if (rewardedItemIds.has(program.premioCatalogoItemId)) return [];
    const snapshot = snapshots.find((entry: any) => entry.item.id === program.premioCatalogoItemId);
    if (!snapshot) return [];
    rewardedItemIds.add(program.premioCatalogoItemId);
    return [{ program, progress, snapshot }];
  });
}

export async function currentFidelityForPhone(db: Db, contaId: number, phone?: string | null) {
  const programs = await db.restauranteFidelidadePrograma.findMany({
    where: { contaId },
    include: { PremioCatalogoItem: { include: { Produto: { select: { nome: true, imagem: true } } } } },
  });
  const normalizedPhone = normalizeFidelityPhone(phone);
  const progressRows = normalizedPhone && programs.length
    ? await db.restauranteFidelidadeProgresso.findMany({
      where: { contaId, telefoneNormalizado: normalizedPhone, programaId: { in: programs.map((program: any) => program.id) } },
    })
    : [];
  const progressByProgram = new Map(progressRows.map((progress: any) => [progress.programaId, progress]));
  return {
    programs: programs.map((program: any) => ({ program, progress: progressByProgram.get(program.id) || null })),
    normalizedPhone,
  };
}

export async function eligibleItemQuantity(tx: Db, contaId: number, order: any, program: any) {
  const catalogItemIds = normalizeFidelityIds(program.catalogoItemIdsJson);
  const categoryIds = normalizeFidelityIds(program.categoriaIdsJson);
  const orderItems = order.itens.filter((item: any) => item.catalogoItemId && Number(item.quantidade) > 0);
  if (!orderItems.length) return 0;
  // Sem filtro, todas as unidades do pedido participam da promoção.
  if (!catalogItemIds.length && !categoryIds.length) return orderItems.reduce((total: number, item: any) => total + Number(item.quantidade), 0);

  const orderedCatalogItemIds = normalizeFidelityIds(orderItems.map((item: any) => item.catalogoItemId));
  const categoryEligibleItemIds = new Set<number>();
  if (categoryIds.length && orderedCatalogItemIds.length) {
    const catalogItems = await tx.restauranteCatalogoItem.findMany({
      where: { contaId, id: { in: orderedCatalogItemIds } },
      select: { id: true, categoriaId: true, Produto: { select: { ProdutoBase: { select: { categoriaId: true } } } } },
    });
    for (const item of catalogItems) {
      const categoryId = item.categoriaId || item.Produto?.ProdutoBase?.categoriaId;
      if (categoryId && categoryIds.includes(categoryId)) categoryEligibleItemIds.add(item.id);
    }
  }
  return orderItems
    .filter((item: any) => catalogItemIds.includes(item.catalogoItemId) || categoryEligibleItemIds.has(item.catalogoItemId))
    .reduce((total: number, item: any) => total + Number(item.quantidade), 0);
}

/** Aplica uma vez o progresso quando um pedido chega a CONCLUIDO. */
export async function applyCompletedOrderFidelity(tx: Db, contaId: number, orderId: number) {
  const programs = await tx.restauranteFidelidadePrograma.findMany({
    where: { contaId, ativo: true, premioCatalogoItemId: { not: null } },
  });
  if (!programs.length) return null;
  const order = await tx.restaurantePedido.findFirst({
    where: { id: orderId, contaId, status: "CONCLUIDO" },
    include: { itens: true },
  });
  if (!order) return null;
  const phone = normalizeFidelityPhone(order.clienteTelefone);
  if (!phone) return null;
  const results: any[] = [];
  for (const program of programs) {
    const eligibleQuantity = await eligibleItemQuantity(tx, contaId, order, program);
    if (!eligibleQuantity) continue;
    const alreadyApplied = await tx.restauranteFidelidadeLancamento.findUnique({
      where: { pedidoId_programaId: { pedidoId: orderId, programaId: program.id } },
    });
    if (alreadyApplied) continue;
    const progress = await tx.restauranteFidelidadeProgresso.upsert({
      where: { programaId_telefoneNormalizado: { programaId: program.id, telefoneNormalizado: phone } },
      create: { contaId, programaId: program.id, telefoneNormalizado: phone, clienteNome: order.clienteNomeSnapshot || null, pedidosElegiveis: eligibleQuantity },
      update: { pedidosElegiveis: { increment: eligibleQuantity }, clienteNome: order.clienteNomeSnapshot || undefined },
    });
    const availableByProgress = Math.floor(progress.pedidosElegiveis / program.pedidosMeta);
    const rewardsToIssue = Math.max(availableByProgress - progress.recompensasEmitidas, 0);
    const issued = rewardsToIssue ? await tx.restauranteFidelidadeProgresso.updateMany({
      where: { id: progress.id, recompensasEmitidas: { lt: availableByProgress } },
      data: { recompensasEmitidas: { increment: rewardsToIssue }, recompensasDisponiveis: { increment: rewardsToIssue } },
    }) : { count: 0 };
    await tx.restauranteFidelidadeLancamento.create({
      data: { contaId, programaId: program.id, pedidoId: orderId, progressoId: progress.id, deltaPedidos: eligibleQuantity, recompensaNova: issued.count > 0 },
    });
    const current = await tx.restauranteFidelidadeProgresso.findUniqueOrThrow({ where: { id: progress.id } });
    results.push({ ...current, novaRecompensa: issued.count > 0, pedidosMeta: program.pedidosMeta, programaId: program.id });
  }
  return results.length ? results : null;
}
