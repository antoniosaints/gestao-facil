import { Request, Response } from "express";
import { Prisma } from "../../../generated";
import { prisma } from "../../utils/prisma";
import { handleError } from "../../utils/handleError";
import { getCustomRequest } from "../../helpers/getCustomRequest";

const ALLOWED_SORT = new Set(["id", "data", "quantidade", "custo"]);
const TIPOS = new Set(["ENTRADA", "SAIDA", "DESCARTE", "TRANSFERENCIA"]);
const STATUSES = new Set(["PENDENTE", "CONCLUIDO", "CANCELADO"]);

/** Monta o filtro Prisma a partir dos parâmetros de auditoria da tela. */
function buildMovimentacoesWhere(
  contaId: number,
  query: Request["query"]
): Prisma.MovimentacoesEstoqueWhereInput {
  const where: Prisma.MovimentacoesEstoqueWhereInput = { contaId };

  const search = String(query.search ?? "").trim();
  if (search) {
    const asNumber = Number(search);
    where.OR = [
      { notaFiscal: { contains: search } },
      { Uid: { contains: search } },
      { Produto: { nome: { contains: search } } },
      { Produto: { codigo: { contains: search } } },
      { ClienteFornecedor: { nome: { contains: search } } },
      ...(Number.isInteger(asNumber) ? [{ id: asNumber }] : []),
    ];
  }

  const notaFiscal = String(query.notaFiscal ?? "").trim();
  if (notaFiscal) where.notaFiscal = { contains: notaFiscal };

  const fornecedorId = Number(query.fornecedorId);
  if (Number.isInteger(fornecedorId) && fornecedorId > 0) {
    where.clienteFornecedor = fornecedorId;
  }

  const produtoId = Number(query.produtoId);
  if (Number.isInteger(produtoId) && produtoId > 0) {
    where.produtoId = produtoId;
  }

  const tipo = String(query.tipo ?? "").trim();
  if (TIPOS.has(tipo)) where.tipo = tipo as Prisma.EnumTipoMovimentacaoFilter["equals"];

  const status = String(query.status ?? "").trim();
  if (STATUSES.has(status)) where.status = status as Prisma.EnumStatusMovimentacaoFilter["equals"];

  const dataFilter: Prisma.DateTimeFilter = {};
  const dataInicio = query.dataInicio ? new Date(String(query.dataInicio)) : null;
  const dataFim = query.dataFim ? new Date(String(query.dataFim)) : null;
  if (dataInicio && !Number.isNaN(dataInicio.getTime())) dataFilter.gte = dataInicio;
  if (dataFim && !Number.isNaN(dataFim.getTime())) dataFilter.lte = dataFim;
  if (dataFilter.gte || dataFilter.lte) where.data = dataFilter;

  return where;
}

function nomeProduto(produto?: { nome: string; nomeVariante: string | null } | null) {
  if (!produto) return "—";
  return produto.nomeVariante && produto.nomeVariante !== "Padrão"
    ? `${produto.nome} / ${produto.nomeVariante}`
    : produto.nome;
}

/** Tabela paginada de movimentações de estoque (auditoria). */
export async function tableMovimentacoes(req: Request, res: Response): Promise<any> {
  try {
    const contaId = getCustomRequest(req).customData.contaId;
    const where = buildMovimentacoesWhere(contaId, req.query);

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));

    const sortBy = ALLOWED_SORT.has(String(req.query.sortBy))
      ? String(req.query.sortBy)
      : "id";
    const order: Prisma.SortOrder = String(req.query.order) === "asc" ? "asc" : "desc";

    const [rows, total] = await Promise.all([
      prisma.movimentacoesEstoque.findMany({
        where,
        orderBy: { [sortBy]: order },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          Produto: { select: { nome: true, nomeVariante: true, codigo: true } },
          ClienteFornecedor: { select: { nome: true } },
          Vendas: { select: { Uid: true } },
          OrdensServico: { select: { id: true } },
        },
      }),
      prisma.movimentacoesEstoque.count({ where }),
    ]);

    const data = rows.map((mov) => ({
      id: mov.id,
      Uid: mov.Uid,
      tipo: mov.tipo,
      status: mov.status,
      data: mov.data,
      notaFiscal: mov.notaFiscal,
      quantidade: mov.quantidade,
      custo: mov.custo,
      frete: mov.frete,
      desconto: mov.desconto,
      produtoId: mov.produtoId,
      produtoNome: nomeProduto(mov.Produto),
      produtoCodigo: mov.Produto?.codigo ?? null,
      fornecedor: mov.ClienteFornecedor?.nome ?? null,
      origem: mov.vendaId
        ? `Venda ${mov.Vendas?.Uid ?? mov.vendaId}`
        : mov.ordemId
          ? `OS #${mov.ordemId}`
          : "Manual",
      valorTotal: Number(mov.custo) * mov.quantidade,
    }));

    return res.status(200).json({
      data,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (error) {
    handleError(res, error);
  }
}

/** Resumo agregado das movimentações filtradas (para os cards da tela). */
export async function resumoMovimentacoes(req: Request, res: Response): Promise<any> {
  try {
    const contaId = getCustomRequest(req).customData.contaId;
    const where = buildMovimentacoesWhere(contaId, req.query);

    const movimentacoes = await prisma.movimentacoesEstoque.findMany({
      where,
      select: { tipo: true, quantidade: true, custo: true },
    });

    const base = () => ({ quantidade: 0, valor: 0, registros: 0 });
    const porTipo: Record<string, { quantidade: number; valor: number; registros: number }> = {
      ENTRADA: base(),
      SAIDA: base(),
      DESCARTE: base(),
      TRANSFERENCIA: base(),
    };

    let valorTotal = 0;
    for (const mov of movimentacoes) {
      const valor = Number(mov.custo) * mov.quantidade;
      const bucket = porTipo[mov.tipo] ?? base();
      bucket.quantidade += mov.quantidade;
      bucket.valor += valor;
      bucket.registros += 1;
      porTipo[mov.tipo] = bucket;
      valorTotal += valor;
    }

    return res.status(200).json({
      totalRegistros: movimentacoes.length,
      valorTotal,
      porTipo,
    });
  } catch (error) {
    handleError(res, error);
  }
}
