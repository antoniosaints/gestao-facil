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

export function publicFidelity(program: any, progress?: any | null) {
  if (!program?.ativo || !program.premioCatalogoItemId) return null;
  return {
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
      pedidosElegiveis: progress.pedidosElegiveis,
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

async function orderMatchesProgram(tx: Db, contaId: number, order: any, program: any) {
  const catalogItemIds = normalizeFidelityIds(program.catalogoItemIdsJson);
  const categoryIds = normalizeFidelityIds(program.categoriaIdsJson);
  // Sem filtro, qualquer pedido concluido participa. Com filtros, basta um item corresponder.
  if (!catalogItemIds.length && !categoryIds.length) return true;
  if (order.itens.some((item: any) => item.catalogoItemId && catalogItemIds.includes(item.catalogoItemId))) return true;
  if (!categoryIds.length) return false;

  const orderedCatalogItemIds = normalizeFidelityIds(order.itens.map((item: any) => item.catalogoItemId));
  if (!orderedCatalogItemIds.length) return false;
  return (await tx.restauranteCatalogoItem.count({
    where: { contaId, id: { in: orderedCatalogItemIds }, categoriaId: { in: categoryIds } },
  })) > 0;
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
    if (!(await orderMatchesProgram(tx, contaId, order, program))) continue;
    const alreadyApplied = await tx.restauranteFidelidadeLancamento.findUnique({
      where: { pedidoId_programaId: { pedidoId: orderId, programaId: program.id } },
    });
    if (alreadyApplied) continue;
    const progress = await tx.restauranteFidelidadeProgresso.upsert({
      where: { programaId_telefoneNormalizado: { programaId: program.id, telefoneNormalizado: phone } },
      create: { contaId, programaId: program.id, telefoneNormalizado: phone, clienteNome: order.clienteNomeSnapshot || null, pedidosElegiveis: 1 },
      update: { pedidosElegiveis: { increment: 1 }, clienteNome: order.clienteNomeSnapshot || undefined },
    });
    const availableByProgress = Math.floor(progress.pedidosElegiveis / program.pedidosMeta);
    const issued = await tx.restauranteFidelidadeProgresso.updateMany({
      where: { id: progress.id, recompensasEmitidas: { lt: availableByProgress } },
      data: { recompensasEmitidas: { increment: 1 }, recompensasDisponiveis: { increment: 1 } },
    });
    await tx.restauranteFidelidadeLancamento.create({
      data: { contaId, programaId: program.id, pedidoId: orderId, progressoId: progress.id, recompensaNova: issued.count > 0 },
    });
    const current = await tx.restauranteFidelidadeProgresso.findUniqueOrThrow({ where: { id: progress.id } });
    results.push({ ...current, novaRecompensa: issued.count > 0, pedidosMeta: program.pedidosMeta, programaId: program.id });
  }
  return results.length ? results : null;
}
