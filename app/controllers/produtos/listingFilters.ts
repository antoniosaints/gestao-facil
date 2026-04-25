import type { Prisma } from "../../../generated";
import { prisma } from "../../utils/prisma";

export type ProdutoEstoqueBaixoFiltro = "TODOS" | "SIM" | "NAO";
export type ProdutoMaisVendasFiltro = "TODOS" | "SIM";

export type ProdutoListingFilters = {
  categoriaId?: number;
  status?: string;
  estoqueBaixo: ProdutoEstoqueBaixoFiltro;
  maisVendas: ProdutoMaisVendasFiltro;
};

type VariantLike = {
  controlaEstoque?: boolean | null;
  estoque?: number | null;
  minimo?: number | null;
};

type BaseLike = {
  variantes?: VariantLike[];
};

function parsePositiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseOptionalStatus(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length ? normalized : undefined;
}

function parseEstoqueBaixo(value: unknown): ProdutoEstoqueBaixoFiltro {
  return value === "SIM" || value === "NAO" ? value : "TODOS";
}

function parseMaisVendas(value: unknown): ProdutoMaisVendasFiltro {
  return value === "SIM" ? "SIM" : "TODOS";
}

export function parseProdutoListingFilters(query: Record<string, unknown>): ProdutoListingFilters {
  return {
    categoriaId: parsePositiveNumber(query.categoriaId),
    status: parseOptionalStatus(query.status),
    estoqueBaixo: parseEstoqueBaixo(query.estoqueBaixo),
    maisVendas: parseMaisVendas(query.maisVendas),
  };
}

export function buildProdutoBaseWhere(contaId: number, filters: ProdutoListingFilters): Prisma.ProdutoBaseWhereInput {
  const where: Prisma.ProdutoBaseWhereInput = {
    contaId,
  };

  if (filters.status) {
    where.status = filters.status as any;
  }

  if (filters.categoriaId) {
    where.categoriaId = filters.categoriaId;
  }

  return where;
}

export function buildProdutoVarianteWhere(contaId: number, filters: ProdutoListingFilters): Prisma.ProdutoWhereInput {
  const where: Prisma.ProdutoWhereInput = {
    contaId,
  };

  if (filters.status) {
    where.status = filters.status as any;
  }

  if (filters.categoriaId) {
    where.ProdutoBase = {
      categoriaId: filters.categoriaId,
    };
  }

  return where;
}

export function isProdutoVariantLowStock(item: VariantLike) {
  return Boolean(item.controlaEstoque) && Number(item.estoque || 0) <= Number(item.minimo || 0);
}

export function isProdutoBaseLowStock(base: BaseLike) {
  return (base.variantes || []).some((item) => isProdutoVariantLowStock(item));
}

export function matchesEstoqueBaixoFilter(isLowStock: boolean, filter: ProdutoEstoqueBaixoFiltro) {
  if (filter === "SIM") return isLowStock;
  if (filter === "NAO") return !isLowStock;
  return true;
}

export async function getSalesTotalsByVariantIds(contaId: number, variantIds: number[]) {
  const totals = new Map<number, number>();

  if (!variantIds.length) {
    return totals;
  }

  const grouped = await prisma.itensVendas.groupBy({
    by: ["produtoId"],
    where: {
      produtoId: { in: variantIds },
      venda: {
        contaId,
      },
    },
    _sum: {
      quantidade: true,
    },
  });

  grouped.forEach((item) => {
    if (!item.produtoId) return;
    totals.set(item.produtoId, Number(item._sum.quantidade || 0));
  });

  return totals;
}

export async function getSalesTotalsByBaseIds(contaId: number, baseIds: number[]) {
  const totals = new Map<number, number>();

  if (!baseIds.length) {
    return totals;
  }

  const variants = await prisma.produto.findMany({
    where: {
      contaId,
      produtoBaseId: { in: baseIds },
    },
    select: {
      id: true,
      produtoBaseId: true,
    },
  });

  const totalsByVariant = await getSalesTotalsByVariantIds(
    contaId,
    variants.map((item) => item.id),
  );

  variants.forEach((variant) => {
    if (!variant.produtoBaseId) return;
    const current = totals.get(variant.produtoBaseId) || 0;
    totals.set(variant.produtoBaseId, current + (totalsByVariant.get(variant.id) || 0));
  });

  return totals;
}
