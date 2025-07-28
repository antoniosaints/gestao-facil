import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { PrismaDataTableBuilder } from "../../services/prismaDatatables";
import { usuariosAcoes } from "./acoes";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { Usuarios } from "../../../generated";
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
    .format("email", function (row) {
      const email = row || "-";
      return `<span class="px-2 py-1.5 border border-gray-700 text-gray-900 bg-gray-100 dark:border-gray-500 dark:bg-gray-950 dark:text-gray-100 rounded-md"><i class="fa-solid fa-at"></i> ${email}</span>`;
    })
    .format("permissao", function (row) {
      return `<span class="px-2 py-1.5 border border-blue-700 text-blue-900 bg-blue-100 dark:border-blue-500 dark:bg-blue-950 dark:text-blue-100 rounded-md"><i class="fa-solid fa-user-lock"></i> ${row}</span>`;
    })
    .format("emailReceiver", function (row) {
       return `
              <label class="flex items-center cursor-pointer">
                <input type="checkbox" value="" class="sr-only peer" ${row ? "checked" : ""}>
                <div class="relative w-11 h-6 bg-red-200 peer-focus:outline-none rounded-full peer dark:bg-red-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-red-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-red-600 peer-checked:bg-emerald-600 dark:peer-checked:bg-emerald-600"></div>
              </label>
              `;
    })
    .format("pushReceiver", function (row) {
       return `
              <label class="flex items-center cursor-pointer">
                <input type="checkbox" value="" class="sr-only peer" ${row ? "checked" : ""}>
                <div class="relative w-11 h-6 bg-red-200 peer-focus:outline-none rounded-full peer dark:bg-red-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-red-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-red-600 peer-checked:bg-emerald-600 dark:peer-checked:bg-emerald-600"></div>
              </label>
              `;
    })
    .format("status", function (value) {
      return `
              <label class="flex items-center cursor-pointer">
                <input type="checkbox" value="" class="sr-only peer" ${value === "ATIVO" ? "checked" : ""}>
                <div class="relative w-11 h-6 bg-red-200 peer-focus:outline-none rounded-full peer dark:bg-red-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-red-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-red-600 peer-checked:bg-emerald-600 dark:peer-checked:bg-emerald-600"></div>
              </label>
              `;
    })
    .addColumn("acoes", (row) => {
      return usuariosAcoes(row);
    });
  const data = await builder.toJson(req.query);
  return res.json(data);
};
