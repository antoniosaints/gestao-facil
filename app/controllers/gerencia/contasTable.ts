import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { PrismaDataTableBuilder } from "../../services/prismaDatatables";
import { Contas } from "../../../generated";
import { isAccountOverdue } from "../../routers/web";
import { formatDateToPtBR, formatLabel } from "../../helpers/formatters";
import { isBefore } from "date-fns";
export const tableContasGerencia = async (
  req: Request,
  res: Response
): Promise<any> => {
  if (await isAccountOverdue(req))
    return res.status(404).json({
      message: "Conta inativa ou bloqueada, verifique seu plano",
    });

  const builder = new PrismaDataTableBuilder<Contas>(prisma.contas)
    .search({
      documento: "string",
      email: "string",
      nome: "string",
      telefone: "string",
      categoria: "string",
    })
    .format("id", function (id) {
       return `<span onclick="visualizarAssinanteConta('${id}')" class="px-2 py-1 flex flex-nowrap cursor-pointer truncate w-max border border-gray-700 text-gray-900 bg-gray-100 dark:border-gray-500 dark:bg-gray-950 dark:text-gray-100 rounded-md">#${id}</span>`;
    })
    .format("vencimento", function (documento) {
      const vencimento = new Date(documento);
      const isDue = isBefore(vencimento, new Date());
      const daysToDue = isDue ? vencimento.getDate() - new Date().getDate() : vencimento.getDate() - new Date().getDate();
      const row = formatDateToPtBR(documento);
      return formatLabel(`${row} ( ${daysToDue} dias )`, isDue ? "red" : "blue", "fa-solid fa-calendar", false);
    })
    .format("status", function (row) {
      let status = "";
      let color = "";
      switch (row) {
        case "ATIVO":
          color = "green";
          status = "Ativo";
          break;
        case "INATIVO":
          color = "red";
          status = "Inativo";
          break;
        case "BLOQUEADO":
          color = "orange";
          status = "Bloqueado";
          break;
      }
      return formatLabel(status, color, "fa-solid fa-lock", false);
    })
    .format("telefone", function (documento) {
      const row = documento || "Sem Telefone";
      return formatLabel(row, "slate", "fa-solid fa-phone", false);
    })
    .format("documento", function (documento) {
      const cpf = documento || "Sem Documento";
      return formatLabel(cpf, "slate", "fa-solid fa-id-card", false);
    })
    .addColumn("acoes", function (row) {
      const id = row.id;

      return `<div class="flex flex-nowrap items-center gap-1 p-1">
                <button
                    onclick="openModalContas(${id})"
                    class="text-success px-1 py-[2px] rounded">
                    <i class="fa-solid fa-user-pen"></i>
                </button>
                <button
                    onclick="excluirConta(${id})"
                    class="text-danger px-1 py-[2px] rounded">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
              </div>`;
    });
  const data = await builder.toJson(req.query);
  return res.json(data);
};
