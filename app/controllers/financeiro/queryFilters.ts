import type { Request } from "express";
import { endOfDay, endOfMonth, startOfDay, startOfMonth } from "date-fns";
import type { Prisma } from "../../../generated";

export type FinanceiroStatusFiltro = "TODOS" | "PAGO" | "PENDENTE" | "ATRASADO";
export type FinanceiroTipoFiltro = "TODOS" | "RECEITA" | "DESPESA";

export type FinanceiroQueryFilters = {
  contaFinanceiraId?: number;
  categoriaId?: number;
  clienteId?: number;
  tipo: FinanceiroTipoFiltro;
  status: FinanceiroStatusFiltro;
  search?: string;
  inicio?: Date;
  fim?: Date;
};

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;

  const parsed = Number(value);
  return Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed;
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim();
  return normalized.length ? normalized : undefined;
}

function parseTipo(value: unknown): FinanceiroTipoFiltro {
  if (value === "RECEITA" || value === "DESPESA") return value;
  return "TODOS";
}

function parseStatus(value: unknown): FinanceiroStatusFiltro {
  if (value === "PAGO" || value === "PENDENTE" || value === "ATRASADO") return value;
  return "TODOS";
}

function parseDateValue(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function parseFinanceiroFilters(
  req: Request,
  options?: {
    defaultRange?: "current-month";
  }
): FinanceiroQueryFilters {
  const inicio = parseDateValue(req.query.inicio);
  const fim = parseDateValue(req.query.fim);

  const currentMonthRange = options?.defaultRange === "current-month";

  return {
    contaFinanceiraId: parseOptionalNumber(req.query.contaFinanceiraId),
    categoriaId: parseOptionalNumber(req.query.categoriaId),
    clienteId: parseOptionalNumber(req.query.clienteId),
    tipo: parseTipo(req.query.tipo),
    status: parseStatus(req.query.status),
    search: parseOptionalString(req.query.search),
    inicio: inicio
      ? startOfDay(inicio)
      : currentMonthRange
        ? startOfMonth(new Date())
        : undefined,
    fim: fim
      ? endOfDay(fim)
      : currentMonthRange
        ? endOfMonth(new Date())
        : undefined,
  };
}

export function buildParcelaFinanceiroWhere(
  contaId: number,
  filters: Pick<FinanceiroQueryFilters, "contaFinanceiraId" | "categoriaId" | "clienteId" | "tipo" | "search">
): Prisma.ParcelaFinanceiroWhereInput {
  const where: Prisma.ParcelaFinanceiroWhereInput = {
    lancamento: {
      contaId,
    },
  };

  if (filters.contaFinanceiraId) {
    where.contaFinanceira = filters.contaFinanceiraId;
  }

  const lancamentoWhere = where.lancamento as Prisma.LancamentoFinanceiroWhereInput;

  if (filters.categoriaId) {
    lancamentoWhere.categoriaId = filters.categoriaId;
  }

  if (filters.clienteId) {
    lancamentoWhere.clienteId = filters.clienteId;
  }

  if (filters.tipo !== "TODOS") {
    lancamentoWhere.tipo = filters.tipo;
  }

  if (filters.search) {
    lancamentoWhere.OR = [
      { descricao: { contains: filters.search } },
      { Uid: { contains: filters.search } },
      { categoria: { nome: { contains: filters.search } } },
      { cliente: { nome: { contains: filters.search } } },
    ];
  }

  return where;
}

export function getParcelaStatus(
  parcela: { pago: boolean; vencimento: Date | string },
  referenceDate: Date = new Date()
): Exclude<FinanceiroStatusFiltro, "TODOS"> {
  if (parcela.pago) return "PAGO";

  const vencimento = startOfDay(new Date(parcela.vencimento));
  const today = startOfDay(referenceDate);

  if (vencimento < today) return "ATRASADO";
  return "PENDENTE";
}

export function matchesStatusFilter(
  parcela: { pago: boolean; vencimento: Date | string },
  status: FinanceiroStatusFiltro,
  referenceDate: Date = new Date()
): boolean {
  if (status === "TODOS") return true;
  return getParcelaStatus(parcela, referenceDate) === status;
}

export function decimalToNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value && typeof (value as { toNumber: () => number }).toNumber === "function") {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value || 0);
}
