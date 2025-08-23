import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { formatCurrency } from "../../utils/formatters";
import { PrismaDataTableBuilder } from "../../services/prismaDatatables";
import { produtosAcoes } from "./acoes";
import { Prisma, Produto, Status } from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { hasPermission } from "../../helpers/userPermission";
import { isAccountOverdue } from "../../routers/web";
import { formatLabel } from "../../helpers/formatters";

export const tableProdutos = async (req: Request, res: Response) => {
  const customData = getCustomRequest(req).customData;
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 10;
  const search = (req.query.search as string) || "";
  const sortBy = (req.query.sortBy as string) || "id";
  const order = req.query.order || "asc";
  const { ...filters } = req.query;

  const where: Prisma.ProdutoWhereInput = {
    contaId: customData.contaId,
  };
  if (search) {
    where.OR = [
      { nome: { contains: search } },
      { codigo: { contains: search } },
      { descricao: { contains: search } },
      { Uid: { contains: search } },
    ];
  }

  if (filters.status) {
    where.status = filters.status as Status;
  }

  const total = await prisma.produto.count({ where });
  const data = await prisma.produto.findMany({
    where,
    orderBy: { [sortBy]: order },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  res.json({
    data,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
};
export const tableProdutos2 = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const canEdit = await hasPermission(customData, 3);
  if (await isAccountOverdue(req))
    return res.status(404).json({
      message: "Conta inativa ou bloqueada, verifique seu plano",
    });
  const builder = new PrismaDataTableBuilder<Produto>(prisma.produto)
    .where({
      OR: [
        {
          contaId: customData.contaId,
        },
      ],
    })
    .search({
      id: "number",
      nome: "string",
      codigo: "string",
    })
    .edit("Uid", function (row) {
      let color = "gray";
      const isLowStock = row.estoque <= row.minimo;
      if (isLowStock) color = "yellow";
      return `<span 
        onclick="visualizarProduto('${row.id}')" 
        class="px-2 py-1 flex flex-nowrap cursor-pointer justify-center items-center gap-2 truncate w-max border border-${color}-700 text-${color}-900 bg-${color}-100 dark:border-${color}-500 dark:bg-${color}-950 dark:text-${color}-100 rounded-md"><i class="fa-solid fa-box text-blue-600"></i> ${row.Uid}</span>`;
    })
    .format("entradas", function (row) {
      return `
              <label class="flex items-center cursor-pointer">
                <input type="checkbox" value="" class="sr-only peer" 
                ${row ? "checked" : ""}
                ${!canEdit ? "disabled" : ""}
              >
                <div class="relative w-11 h-6 bg-red-200 peer-focus:outline-none rounded-full peer dark:bg-red-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-red-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-red-600 peer-checked:bg-emerald-600 dark:peer-checked:bg-emerald-600"></div>
              </label>
              `;
    })
    .format("saidas", function (row) {
      return `
              <label class="flex items-center cursor-pointer">
                <input type="checkbox" value="" class="sr-only peer" 
                ${row ? "checked" : ""}
                ${!canEdit ? "disabled" : ""}>
                <div class="relative w-11 h-6 bg-red-200 peer-focus:outline-none rounded-full peer dark:bg-red-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-red-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-red-600 peer-checked:bg-emerald-600 dark:peer-checked:bg-emerald-600"></div>
              </label>
              `;
    })
    .format("codigo", function (row) {
      const codigo = row || "-";
      return formatLabel(codigo, "blue", "fa-solid fa-barcode");
    })
    .edit("nome", function (row) {
      return `<span class="text-sm">${row.nome}</span>`;
    })
    .format("preco", (value) => formatCurrency(value))
    .edit("estoque", function (row) {
      const estoque = row.estoque.toString().padStart(2, "0");
      return formatLabel(
        estoque + " " + row.unidade,
        "gray",
        "fa-solid fa-box"
      );
    })
    .include(["id", "nome", "preco", "estoque", "codigo"])
    .addColumn("acoes", (row) => {
      return produtosAcoes(row, canEdit);
    });
  const data = await builder.toJson(req.query);
  return res.json(data);
};
