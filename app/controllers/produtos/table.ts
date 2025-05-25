import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { formatCurrency } from "../../utils/formatters";
import { PrismaDataTableBuilder } from "../../services/prismaDatatables";
import { produtosAcoes } from "./acoes";
import { Produto } from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
export const tableProdutos = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  if (customData.contaStatus !== "ATIVO") return res.status(404).json({
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
    .format("id", function (id) {
      return `<span class="px-2 py-0 flex flex-nowrap w-max text-primary bg-primary/20 rounded-md"># ${id}</span>`;
    })
    .format("codigo", function (row) {
      const codigo = row || "-";
      return `<span class="px-2 py-0.5 text-gray-600 dark:text-gray-300 bg-gray-200/20 dark:bg-gray-700/20 text-gray-500 rounded-md">${codigo}</span>`;
    })
    .edit("nome", function (row) {
      return `<span onclick="visualizarProduto('${row.id}')" class="text-gray-700 hover:text-gray-500 dark:text-gray-200 dark:hover:text-gray-300 cursor-pointer">${row.nome}</span>`;
    })
    .format("preco", (value) => {
      return `<span class="px-2 py-0.5 text-green-600 dark:text-green-300 bg-green-200/20 dark:bg-green-800/20 text-green-400 rounded-md">${formatCurrency(value)}</span>`;
    })
    .format("estoque", function (value) {
      const estoque = value.toString().padStart(2, "0");
      return `<span class="px-2 py-0 rounded-md">${estoque}</span>`;
    })
    .include(["id", "nome", "preco", "estoque", "codigo"])
    .addColumn("acoes", (row) => {
      return produtosAcoes(row);
    });
  const data = await builder.toJson(req.query);
  return res.json(data);
};
