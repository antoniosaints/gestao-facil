import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { PrismaDataTableBuilder } from "../../services/prismaDatatables";
import { Usuarios } from "@prisma/client";
import { usuariosAcoes } from "./acoes";
import { getCustomRequest } from "../../helpers/getCustomRequest";
export const tableUsuarios = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const builder = new PrismaDataTableBuilder<Usuarios>(prisma.usuarios)
    .where({
      OR: [
        {
          contaId: customData.contaId,
        },
      ],
    })
    .search({
      nome: "string",
      email: "string",
    })
    .format("id", function (id) {
      return `<span class="px-2 py-1 flex flex-nowrap w-max text-primary bg-primary/20 rounded-md"># ${id}</span>`;
    })
    .format("email", function (row) {
      const codigo = row || "-";
      return `<span class="px-2 py-1 text-blue-600 dark:text-blue-300 bg-secondary/20 rounded-md"><i class="fa-solid fa-at"></i> ${codigo}</span>`;
    })
    .format("status", function (value) {
      const status = value === "ATIVO" ? "Ativo" : "Inativo";
      const statusColor = value === "ATIVO" ? "text-green-600 dark:text-green-300 bg-green-500/10 dark:bg-green-500/20" : "text-red-500 dark:text-red-300 bg-red-500/20 dark:bg-red-500/20";
      return `<span class="px-2 py-1 rounded-md ${statusColor}">${status}</span>`;
    })
    .addColumn("acoes", (row) => {
      return usuariosAcoes(row);
    });
  const data = await builder.toJson(req.query);
  return res.json(data);
};
