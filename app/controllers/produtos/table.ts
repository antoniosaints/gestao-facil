import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { formatCurrency } from "../../utils/formatters";
import { PrismaDataTableBuilder } from "../../services/prismaDatatables";
import { produtosAcoes } from "./acoes";
import { Produto } from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { hasPermission } from "../../helpers/userPermission";
import { isAccountOverdue } from "../../routers/web";
export const tableProdutos = async (
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
    .format("Uid", function (id) {
      return `<span class="px-2 py-1 flex flex-nowrap truncate w-max border border-gray-700 text-gray-900 bg-gray-100 dark:border-gray-500 dark:bg-gray-950 dark:text-gray-100 rounded-md">#${id}</span>`;
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
      return `<span class="px-2 py-1.5 border border-blue-700 text-blue-900 bg-blue-100 dark:border-blue-500 dark:bg-blue-950 dark:text-blue-100 rounded-md">${codigo}</span>`;
    })
    .edit("nome", function (row) {
      return `<span onclick="visualizarProduto('${row.id}')" class="text-blue-700 hover:text-blue-500 dark:text-blue-100 dark:hover:text-blue-300 cursor-pointer">${row.nome}</span>`;
    })
    .format("preco", (value) => formatCurrency(value))
    .edit("estoque", function (row) {
      const estoque = row.estoque.toString().padStart(2, "0");
      return `<span class="px-2 py-1.5 rounded-md dark:bg-gray-600 dark:text-white bg-slate-200">${estoque} ${row.unidade}</span>`;
    })
    .include(["id", "nome", "preco", "estoque", "codigo"])
    .addColumn("acoes", (row) => {
      return produtosAcoes(row, canEdit);
    });
  const data = await builder.toJson(req.query);
  return res.json(data);
};
