import type { Prisma } from "../../../generated";
import {
  applyIgnoredParcelaFilter,
  type parseFinanceiroFilters,
} from "./queryFilters";
import type { FinanceSummaryScope } from "./tableSummaryFilter";

export function buildLancamentoWhere(
  contaId: number,
  filters: ReturnType<typeof parseFinanceiroFilters>,
  summary?: FinanceSummaryScope,
): Prisma.LancamentoFinanceiroWhereInput {
  const where: Prisma.LancamentoFinanceiroWhereInput = {
    contaId,
  };

  if (summary) {
    where.tipo = summary.tipo;
    where.ignorado = false;
    where.AND = [{ parcelas: { some: summary.where } }];
  } else if (filters.tipo !== "TODOS") {
    where.tipo = filters.tipo;
  }

  if (!summary && filters.status !== "TODOS") {
    where.status = filters.status;
  }

  if (filters.origem && filters.origem !== "TODOS") {
    where.origemSistema = filters.origem;
  }

  if (filters.modalidade === "PARCELADOS") {
    where.recorrente = true;
    where.recorrencia = { is: null };
  }

  if (filters.modalidade === "RECORRENTES") {
    where.recorrencia = { isNot: null };
  }

  // O estado de ignorado é operacionalmente definido nas parcelas. Assim, um
  // lançamento entra no filtro assim que qualquer uma de suas parcelas tiver
  // sido ignorada, mesmo que as demais ainda estejam ativas.
  applyIgnoredParcelaFilter(where, filters.ignorado);

  if (filters.contaFinanceiraId) {
    where.contasFinanceiroId = filters.contaFinanceiraId;
  }

  if (filters.categoriaId) {
    where.categoriaId = filters.categoriaId;
  }

  if (filters.clienteId) {
    where.clienteId = filters.clienteId;
  }

  if (!summary && (filters.inicio || filters.fim)) {
    where.dataLancamento = {
      ...(filters.inicio ? { gte: filters.inicio } : {}),
      ...(filters.fim ? { lte: filters.fim } : {}),
    };
  }

  if (filters.search) {
    where.OR = [
      { descricao: { contains: filters.search } },
      { Uid: { contains: filters.search } },
      { venda: { Uid: { contains: filters.search } } },
      { categoria: { nome: { contains: filters.search } } },
      { cliente: { nome: { contains: filters.search } } },
      { ContasFinanceiro: { nome: { contains: filters.search } } },
      { assinaturaPagar: { nomeServico: { contains: filters.search } } },
    ];
  }

  return where;
}
