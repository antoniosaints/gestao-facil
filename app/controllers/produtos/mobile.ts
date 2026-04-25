import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import {
  buildProdutoBaseWhere,
  buildProdutoVarianteWhere,
  getSalesTotalsByBaseIds,
  getSalesTotalsByVariantIds,
  isProdutoBaseLowStock,
  isProdutoVariantLowStock,
  matchesEstoqueBaixoFilter,
  parseProdutoListingFilters,
} from "./listingFilters";

function mapVariantRow(produto: any) {
  return {
    id: produto.id,
    Uid: produto.Uid,
    nome: produto.nome,
    nomeVariante: produto.nomeVariante,
    descricao: produto.descricao,
    status: produto.status,
    preco: produto.preco,
    codigo: produto.codigo,
    unidade: produto.unidade,
    estoque: produto.estoque,
    minimo: produto.minimo,
    mostrarNoPdv: produto.mostrarNoPdv,
    materiaPrima: produto.materiaPrima,
    produtoBaseId: produto.produtoBaseId,
    produtoBaseNome: produto.ProdutoBase?.nome ?? produto.nome,
    categoriaId: produto.ProdutoBase?.categoriaId ?? null,
    categoria: produto.ProdutoBase?.Categoria?.nome ?? produto.categoria ?? null,
    ehPadrao: produto.ehPadrao,
    totalVendas: 0,
  };
}

function mapBaseRow(base: any) {
  const variantePadrao = base.variantes.find((item: any) => item.ehPadrao) ?? base.variantes[0] ?? null;

  return {
    id: base.id,
    Uid: base.Uid,
    nome: base.nome,
    descricao: base.descricao,
    status: base.status,
    categoriaId: base.categoriaId,
    categoria: base.Categoria?.nome ?? null,
    estoqueTotal: base.variantes.reduce((acc: number, item: any) => acc + item.estoque, 0),
    totalVariantes: base.variantes.length,
    preco: variantePadrao?.preco ?? 0,
    codigo: variantePadrao?.codigo ?? null,
    unidade: variantePadrao?.unidade ?? null,
    mostrarNoPdv: variantePadrao?.mostrarNoPdv ?? true,
    materiaPrima: variantePadrao?.materiaPrima ?? false,
    variantePadraoId: variantePadrao?.id ?? null,
    totalVendas: 0,
  };
}

export const ListagemMobileProdutos = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const {
    search = undefined,
    limit = "10",
    page = "1",
    listingMode = "base",
  } = req.query as { search: string; limit: string; page: string; listingMode?: string };

  try {
    const take = Number(limit);
    const currentPage = Number(page);
    const skip = (currentPage - 1) * take;
    const filters = parseProdutoListingFilters(req.query as Record<string, unknown>);

    if (listingMode === "variante") {
      const where = buildProdutoVarianteWhere(customData.contaId, filters);
      if (search) {
        where.OR = [
          { nome: { contains: search } },
          { nomeVariante: { contains: search } },
          { codigo: { contains: search } },
          { descricao: { contains: search } },
          { Uid: { contains: search } },
          { ProdutoBase: { nome: { contains: search } } },
          { ProdutoBase: { Categoria: { nome: { contains: search } } } },
        ];
      }

      const data = await prisma.produto.findMany({
        where,
        include: {
          ProdutoBase: {
            include: {
              Categoria: true,
            },
          },
        },
      });

      let rows = data.map(mapVariantRow);
      rows = rows.filter((row) => matchesEstoqueBaixoFilter(isProdutoVariantLowStock(row), filters.estoqueBaixo));

      const salesTotals = await getSalesTotalsByVariantIds(
        customData.contaId,
        rows.map((item) => item.id),
      );

      rows = rows.map((row) => ({
        ...row,
        totalVendas: salesTotals.get(row.id) || 0,
      }));

      if (filters.maisVendas === "SIM") {
        rows = rows
          .filter((row) => row.totalVendas > 0)
          .sort((a, b) => b.totalVendas - a.totalVendas);
      } else {
        rows.sort((a, b) => String(a.nomeVariante || "").localeCompare(String(b.nomeVariante || "")));
      }

      const total = rows.length;

      return res.json({
        data: rows.slice(skip, skip + take),
        pagination: {
          total,
          page: currentPage,
          limit: take,
          totalPages: Math.ceil(total / take),
        },
      });
    }

    const where = buildProdutoBaseWhere(customData.contaId, filters);
    if (search) {
      where.OR = [
        { nome: { contains: search } },
        { descricao: { contains: search } },
        { Uid: { contains: search } },
        { Categoria: { nome: { contains: search } } },
        {
          variantes: {
            some: {
              OR: [{ nomeVariante: { contains: search } }, { codigo: { contains: search } }],
            },
          },
        },
      ];
    }

    const data = await prisma.produtoBase.findMany({
      where,
      include: {
        Categoria: true,
        variantes: {
          orderBy: [{ ehPadrao: "desc" }, { id: "asc" }],
        },
      },
    });

    const basesRows = data.map(mapBaseRow);
    let rows = basesRows.filter((row, index) => matchesEstoqueBaixoFilter(isProdutoBaseLowStock(data[index]), filters.estoqueBaixo));

    const salesTotals = await getSalesTotalsByBaseIds(
      customData.contaId,
      rows.map((item) => item.id),
    );

    rows = rows.map((row) => ({
      ...row,
      totalVendas: salesTotals.get(row.id) || 0,
    }));

    if (filters.maisVendas === "SIM") {
      rows = rows
        .filter((row) => row.totalVendas > 0)
        .sort((a, b) => b.totalVendas - a.totalVendas);
    } else {
      rows.sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));
    }

    const total = rows.length;

    res.json({
      data: rows.slice(skip, skip + take),
      pagination: {
        total,
        page: currentPage,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message || "Erro ao buscar os dados" });
  }
};
