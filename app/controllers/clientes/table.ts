import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { PrismaDataTableBuilder } from "../../services/prismaDatatables";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { acoes } from "./acoes";
import { Clientes } from "@prisma/client";
export const tableClientes = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  if (customData.contaStatus !== "ATIVO")
    return res.status(404).json({
      message: "Conta inativa ou bloqueada, verifique seu plano",
    });
  const builder = new PrismaDataTableBuilder<Clientes>(prisma.clientesFornecedores)
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
      email: "string",
    })
    .format("id", function (id) {
      return `<span class="px-2 py-1 flex flex-nowrap w-max border border-gray-700 text-gray-900 bg-gray-100 dark:border-gray-500 dark:bg-gray-950 dark:text-gray-100 rounded-md"># ${id}</span>`;
    })
    .format("email", function (row) {
      const data = row || "Sem E-mail";
      return `<span class="px-2 py-1 bg-purple-100 dark:bg-purple-800 text-purple-500 dark:text-purple-100 rounded-md">${data}</span>`;
    })
    .format("status", function (row) {
      const data = row === "ATIVO" ? "Ativo" : "Inativo";
      return `<span class="px-2 py-1 bg-blue-100 dark:bg-blue-800 text-blue-500 dark:text-blue-100 rounded-md">${data}</span>`;
    })
    .format("telefone", function (row) {
      const data = row || "Sem Telefone";
      return `<span class="px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-100 rounded-md">${data}</span>`;
    })
    .addColumn("acoes", (row) => {
      return acoes(row);
    });
  const data = await builder.toJson(req.query);
  return res.json(data);
};
