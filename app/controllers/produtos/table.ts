import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { formatCurrency } from "../../utils/formatters";
import { PrismaDataTableBuilder } from "../../services/prismaDatatables";
import { Produto } from "@prisma/client";
import { produtosAcoes } from "./acoes";
export const tableProdutos = async (
  req: Request,
  res: Response
): Promise<any> => {
  const builder = new PrismaDataTableBuilder<Produto>(prisma.produto)
    .search({
      nome: "string",
      preco: "number",
      estoque: "number",
    })
    .format("id", function(id) {
      return `<span class="px-2 py-0 flex flex-nowrap w-max text-primary bg-primary/20 rounded-md"># ${id}</span>`;
    })
    .format("codigo", function(row) {
      const codigo = row || "-";
      return `<span class="px-2 py-0 text-blue-500 rounded-md">${codigo}</span>`;
    })
    .edit("nome", function(row) {
      return `<span onclick="visualizarProduto('${row.id}')" class="text-blue-700 hover:text-blue-500 dark:text-blue-500 dark:hover:text-blue-300 cursor-pointer">${row.nome}</span>`;
    })
    .format("preco", (value) => formatCurrency(value))
    .format("estoque", function (value) {
      const estoque = value.toString().padStart(2, "0");
      return `<span class="px-2 py-0 text-white rounded-md"><i class="fa-solid fa-box"></i> ${estoque}</span>`;
    })
    .addColumn("acoes", (row) => {
      return produtosAcoes(row);
    });
  const data = await builder.toJson(req.query);
  return res.json(data);
};
