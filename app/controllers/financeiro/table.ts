import { Request, Response } from "express";
import { clampPageSize } from "../../utils/pagination";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { isAccountOverdue } from "../../routers/web";
import {
  applyTotalParcelasFilter,
  parseFinanceiroFilters,
} from "./queryFilters";
import { atualizarStatusLancamentos } from "./hooks";
import { buildLancamentoWhere } from "./tableFilters";
import {
  getFinanceSummaryScope,
  summarizeMatchingParcels,
} from "./tableSummaryFilter";

function resolveSortField(value: unknown) {
  const sortBy = typeof value === "string" ? value : "dataLancamento";

  switch (sortBy) {
    case "Uid":
      return "Uid";
    case "tipo":
      return "tipo";
    case "status":
      return "status";
    case "descricao":
      return "descricao";
    case "valorTotal":
      return "valorTotal";
    case "dataLancamento":
      return "dataLancamento";
    case "categoriaId":
      return "categoriaId";
    case "createdAt":
      return "createdAt";
    default:
      return "dataLancamento";
  }
}

function resolveSortOrder(value: unknown): "asc" | "desc" {
  return value === "desc" ? "desc" : "asc";
}

export const tableFinanceiro = async (
  req: Request,
  res: Response,
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  if (await isAccountOverdue(req)) {
    return res.status(404).json({
      message: "Conta inativa ou bloqueada, verifique seu plano",
    });
  }

  // A listagem é a referência visual do ciclo financeiro. Sincronizamos antes
  // de consultar para não manter como pendente uma parcela já efetivada.
  await atualizarStatusLancamentos(customData.contaId);

  const page = parseInt(req.query.page as string) || 1;
  const pageSize = clampPageSize(req.query.pageSize);
  const filters = parseFinanceiroFilters(req);
  const summary = getFinanceSummaryScope(
    req.query.resumo,
    parseFinanceiroFilters(req, { defaultRange: "current-month" }),
  );
  const sortBy = resolveSortField(req.query.sortBy);
  const order = resolveSortOrder(req.query.order);

  const where = await applyTotalParcelasFilter(
    buildLancamentoWhere(customData.contaId, filters, summary),
    customData.contaId,
    filters,
  );

  const [total, data] = await Promise.all([
    prisma.lancamentoFinanceiro.count({ where }),
    prisma.lancamentoFinanceiro.findMany({
      where,
      include: {
        parcelas: {
          orderBy: [{ vencimento: "asc" }, { numero: "asc" }, { id: "asc" }],
        },
        recorrencia: true,
        categoria: true,
        cliente: true,
        ContasFinanceiro: true,
        assinaturaPagar: {
          select: {
            id: true,
            nomeServico: true,
            icone: true,
            corDestaque: true,
          },
        },
      },
      orderBy: { [sortBy]: order },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  res.json({
    data: summary
      ? data.map((row) => ({
          ...row,
          ...summarizeMatchingParcels(row.parcelas, summary),
        }))
      : data,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
};
