import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { PrismaDataTableBuilder } from "../../services/prismaDatatables";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { acoes } from "./acoes";
import { isAccountOverdue } from "../../routers/web";
import { ClientesFornecedores } from "../../../generated";
import { formatLabel } from "../../helpers/formatters";

const formatLabelId = (row: ClientesFornecedores) => {
  let color = "text-blue-500";
  let icon = `<i class="fa-solid ${color} fa-user"></i>`;

  if (row.tipo === "FORNECEDOR") {
    color = "text-yellow-500";
    icon = `<i class="fa-solid ${color} fa-building"></i>`
  };
  
  
  return `<span title="${row.telefone}" class="px-2 py-1 flex flex-nowrap justify-center items-center gap-2 w-max border border-gray-700 text-gray-900 bg-gray-100 dark:border-gray-500 dark:bg-gray-950 dark:text-gray-100 rounded-md">
    ${icon}${row.Uid}
  </span>`;
};

export const tableClientes = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  if (await isAccountOverdue(req))
    return res.status(404).json({
      message: "Conta inativa ou bloqueada, verifique seu plano",
    });
  const builder = new PrismaDataTableBuilder<ClientesFornecedores>(prisma.clientesFornecedores)
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
    .edit("Uid", function (id) {
      return formatLabelId(id);
    })
    .format("email", function (row) {
      const data = row || "Sem E-mail";
      return formatLabel(data, "slate", "fa-solid fa-envelope", false);
    })
    .format("status", function (row) {
      const data = row === "ATIVO" ? "Ativo" : "Inativo";
      const color = row === "ATIVO" ? "green" : "red";
      return formatLabel(data, color, "fa-solid fa-user");
    })
    .format("telefone", function (row) {
      const data = row || "Sem Telefone";
      return formatLabel(data, "gray", "fa-solid fa-phone");
    })
    .addColumn("acoes", (row) => {
      return acoes(row);
    });
  const data = await builder.toJson(req.query);
  return res.json(data);
};
