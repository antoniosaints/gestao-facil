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
  if (customData.contaStatus !== "ATIVO")
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
    .format("id", function (id) {
      return `<span class="px-2 py-1 flex flex-nowrap w-max text-primary bg-primary/20 rounded-md"># ${id}</span>`;
    })
    .format("codigo", function (row) {
      const codigo = row || "-";
      return `<span class="px-2 py-1 text-blue-500 dark:text-blue-300 rounded-md">${codigo}</span>`;
    })
    .edit("nome", function (row) {
      return `<span onclick="visualizarProduto('${row.id}')" class="text-blue-700 hover:text-blue-500 dark:text-blue-100 dark:hover:text-blue-300 cursor-pointer">${row.nome}</span>`;
    })
    .format("preco", (value) => formatCurrency(value))
    .edit("estoque", function (row) {
      const estoque = row.estoque.toString().padStart(2, "0");
      return `<span class="px-2 py-1 rounded-md dark:bg-gray-600 dark:text-white bg-slate-200">${estoque} ${row.unidade}</span>`;
    })
    .include(["id", "nome", "preco", "estoque", "codigo"])
    .addColumn("acoes", (row) => {
      return produtosAcoes(row);
    });
  const data = await builder.toJson(req.query);
  return res.json(data);
};
