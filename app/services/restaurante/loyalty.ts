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
      nome: program.PremioCatalogoItem.nomePublico || program.PremioCatalogoItem.Produto.nome,
      imagem: program.PremioCatalogoItem.imagem || program.PremioCatalogoItem.Produto.imagem || null,
    } : null,
    progresso: progress ? {
      pedidosElegiveis: progress.pedidosElegiveis,
      pedidosMeta: program.pedidosMeta,
      recompensasDisponiveis: progress.recompensasDisponiveis,
    } : null,
  };
}

export async function currentFidelityForPhone(db: Db, contaId: number, phone?: string | null) {
  const program = await db.restauranteFidelidadePrograma.findUnique({
    where: { contaId },
    include: { PremioCatalogoItem: { include: { Produto: { select: { nome: true, imagem: true } } } } },
  });
  const normalizedPhone = normalizeFidelityPhone(phone);
  const progress = normalizedPhone
    ? await db.restauranteFidelidadeProgresso.findUnique({ where: { contaId_telefoneNormalizado: { contaId, telefoneNormalizado: normalizedPhone } } })
    : null;
  return { program, progress, normalizedPhone };
}

function orderMatchesProgram(order: any, program: any) {
  const catalogItemIds = normalizeFidelityIds(program.catalogoItemIdsJson);
  const categoryIds = normalizeFidelityIds(program.categoriaIdsJson);
  // Sem filtro, qualquer pedido concluido participa. Com filtros, basta um item corresponder.
  if (!catalogItemIds.length && !categoryIds.length) return true;
  return order.itens.some((item: any) =>
    (item.catalogoItemId && catalogItemIds.includes(item.catalogoItemId))
    || (item.Produto?.ProdutoBase?.categoriaId && categoryIds.includes(item.Produto.ProdutoBase.categoriaId)),
  );
}

/** Aplica uma vez o progresso quando um pedido chega a CONCLUIDO. */
export async function applyCompletedOrderFidelity(tx: Db, contaId: number, orderId: number) {
  const program = await tx.restauranteFidelidadePrograma.findUnique({ where: { contaId } });
  if (!program?.ativo || !program.premioCatalogoItemId) return null;
  const order = await tx.restaurantePedido.findFirst({
    where: { id: orderId, contaId, status: "CONCLUIDO" },
    include: { itens: { include: { Produto: { select: { ProdutoBase: { select: { categoriaId: true } } } } } } },
  });
  if (!order || !orderMatchesProgram(order, program)) return null;
  const phone = normalizeFidelityPhone(order.clienteTelefone);
  if (!phone) return null;

  const alreadyApplied = await tx.restauranteFidelidadeLancamento.findUnique({ where: { pedidoId: orderId } });
  if (alreadyApplied) return null;
  const progress = await tx.restauranteFidelidadeProgresso.upsert({
    where: { contaId_telefoneNormalizado: { contaId, telefoneNormalizado: phone } },
    create: { contaId, telefoneNormalizado: phone, clienteNome: order.clienteNomeSnapshot || null, pedidosElegiveis: 1 },
    update: { pedidosElegiveis: { increment: 1 }, clienteNome: order.clienteNomeSnapshot || undefined },
  });
  const availableByProgress = Math.floor(progress.pedidosElegiveis / program.pedidosMeta);
  const issued = await tx.restauranteFidelidadeProgresso.updateMany({
    where: { id: progress.id, recompensasEmitidas: { lt: availableByProgress } },
    data: { recompensasEmitidas: { increment: 1 }, recompensasDisponiveis: { increment: 1 } },
  });
  await tx.restauranteFidelidadeLancamento.create({
    data: { contaId, pedidoId: orderId, progressoId: progress.id, recompensaNova: issued.count > 0 },
  });
  const current = await tx.restauranteFidelidadeProgresso.findUniqueOrThrow({ where: { id: progress.id } });
  return { ...current, novaRecompensa: issued.count > 0, pedidosMeta: program.pedidosMeta };
}
