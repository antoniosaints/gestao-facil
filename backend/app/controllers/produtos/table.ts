import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { formatCurrency } from "../../utils/formatters";
import { PrismaDataTableBuilder } from "../../services/prismaDatatables";
import { Produto } from "@prisma/client";
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
    .edit("nome", function(row) {
      return `<span onclick="visualizarProduto('${row.id}')" class="text-blue-700 hover:text-blue-500 dark:text-blue-500 dark:hover:text-blue-300 cursor-pointer">${row.nome}</span>`;
    })
    .format("preco", (value) => formatCurrency(value))
    .format("precoCompra", (value) => {
      if (value === null) {
        return "R$ 0,00";
      }
      return formatCurrency(value);
    })
    .format("estoque", function (value) {
      const estoque = value.toString().padStart(2, "0");
      return `<span class="px-2 py-1 bg-gray-600 text-white rounded-md">${estoque}</span>`;
    })
    .addColumn("acoes", (row) => {
      return `
          <button
            onclick="visualizarProduto('${row.id}')"
            class="text-cyan-500 px-1 py-[2px] rounded">
            <i class="fa-solid fa-eye"></i>
          </button>
          <button
            onclick="editarProduto('${row.id}')"
            class="text-success px-1 py-[2px] rounded">
            <i class="fa-solid fa-user-pen"></i>
          </button>
          <button
            onclick="excluirProduto('${row.id}')"
            class="text-danger px-1 py-[2px] rounded">
            <i class="fa-solid fa-trash-can"></i>
          </button>`;
    });
  const data = await builder.toJson(req.query);
  return res.json(data);
};
