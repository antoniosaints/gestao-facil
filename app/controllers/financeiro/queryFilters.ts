import type { Request } from "express";
import { endOfDay, endOfMonth, startOfDay, startOfMonth } from "date-fns";
import type { Prisma } from "../../../generated";
import { prisma } from "../../utils/prisma";

export type FinanceiroStatusFiltro = "TODOS" | "PAGO" | "PENDENTE" | "ATRASADO";
export type FinanceiroTipoFiltro = "TODOS" | "RECEITA" | "DESPESA";
export type FinanceiroOrigemFiltro = "TODOS" | "ASSINATURA_PAGAR";
export type FinanceiroIgnoradoFiltro = "TODOS" | "COM_PARCELA_IGNORADA" | "SEM_PARCELA_IGNORADA";

export type FinanceiroQueryFilters = {
  contaFinanceiraId?: number;
  categoriaId?: number;
  clienteId?: number;
  tipo: FinanceiroTipoFiltro;
  status: FinanceiroStatusFiltro;
  origem: FinanceiroOrigemFiltro;
  ignorado: FinanceiroIgnoradoFiltro;
  search?: string;
  inicio?: Date;
  fim?: Date;
  valorMinimo?: number;
  valorMaximo?: number;
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

function parseOptionalAmount(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;

  const rawValue = String(value).trim().replace(/\s/g, "");
  const normalized = rawValue.includes(",") && rawValue.includes(".")
    ? rawValue.replace(/\./g, "").replace(",", ".")
    : rawValue.replace(",", ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseTipo(value: unknown): FinanceiroTipoFiltro {
  if (value === "RECEITA" || value === "DESPESA") return value;
  return "TODOS";
}

function parseStatus(value: unknown): FinanceiroStatusFiltro {
  if (value === "PAGO" || value === "PENDENTE" || value === "ATRASADO") return value;
  return "TODOS";
}

function parseOrigem(value: unknown): FinanceiroOrigemFiltro {
  if (value === "ASSINATURA_PAGAR") return value;
  return "TODOS";
}

function parseIgnorado(value: unknown): FinanceiroIgnoradoFiltro {
  if (value === "COM_PARCELA_IGNORADA" || value === "SEM_PARCELA_IGNORADA") return value;
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
    origem: parseOrigem(req.query.origem),
    ignorado: parseIgnorado(req.query.ignorado),
    search: parseOptionalString(req.query.search),
    valorMinimo: parseOptionalAmount(req.query.valorMinimo),
    valorMaximo: parseOptionalAmount(req.query.valorMaximo),
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
  filters: Pick<FinanceiroQueryFilters, "contaFinanceiraId" | "categoriaId" | "clienteId" | "tipo" | "search"> & { origem?: FinanceiroOrigemFiltro },
  options?: { incluirIgnoradas?: boolean },
): Prisma.ParcelaFinanceiroWhereInput {
  const where: Prisma.ParcelaFinanceiroWhereInput = {
    ...(options?.incluirIgnoradas ? {} : { ignorado: false }),
    lancamento: {
      contaId,
      ...(options?.incluirIgnoradas ? {} : { ignorado: false }),
    },
  };

  if (filters.contaFinanceiraId) {
    where.OR = [
      { contaFinanceira: filters.contaFinanceiraId },
      {
        contaFinanceira: null,
        lancamento: {
          contasFinanceiroId: filters.contaFinanceiraId,
        },
      },
    ];
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

  if (filters.origem && filters.origem !== "TODOS") {
    lancamentoWhere.origemSistema = filters.origem;
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

/** Mantém itens ignorados visíveis sem permitir que alterem saldos e totais. */
export function isParcelaConsideradaNoResumo(parcela: {
  ignorado?: boolean | null;
  lancamento?: { ignorado?: boolean | null } | null;
}) {
  return !parcela.ignorado && !parcela.lancamento?.ignorado;
}

export function applyIgnoredParcelaFilter(
  where: Prisma.LancamentoFinanceiroWhereInput,
  filtro: FinanceiroIgnoradoFiltro,
): Prisma.LancamentoFinanceiroWhereInput {
  if (filtro === "COM_PARCELA_IGNORADA") {
    where.parcelas = { some: { ignorado: true } };
  }

  if (filtro === "SEM_PARCELA_IGNORADA") {
    where.parcelas = { none: { ignorado: true } };
  }

  return where;
}

export function matchesTotalParcelasFilter(
  total: number,
  valorMinimo?: number,
  valorMaximo?: number,
) {
  return (valorMinimo === undefined || total >= valorMinimo)
    && (valorMaximo === undefined || total <= valorMaximo);
}

/**
 * O total exibido de um lançamento é formado pelas parcelas. O filtro também
 * usa essa soma, em vez de depender do campo denormalizado `valorTotal`.
 */
export async function applyTotalParcelasFilter(
  where: Prisma.LancamentoFinanceiroWhereInput,
  contaId: number,
  filters: Pick<FinanceiroQueryFilters, "valorMinimo" | "valorMaximo">,
): Promise<Prisma.LancamentoFinanceiroWhereInput> {
  if (filters.valorMinimo === undefined && filters.valorMaximo === undefined) {
    return where;
  }

  const totaisPorLancamento = await prisma.parcelaFinanceiro.groupBy({
    by: ["lancamentoId"],
    where: { lancamento: { contaId } },
    _sum: { valor: true },
  });
  const lancamentoIds = totaisPorLancamento
    .filter((item) => matchesTotalParcelasFilter(
      decimalToNumber(item._sum.valor),
      filters.valorMinimo,
      filters.valorMaximo,
    ))
    .map((item) => item.lancamentoId);

  where.AND = [
    ...(where.AND ? Array.isArray(where.AND) ? where.AND : [where.AND] : []),
    { id: { in: lancamentoIds } },
  ];

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
