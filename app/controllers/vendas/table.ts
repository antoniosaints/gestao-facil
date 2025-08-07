import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { PrismaDataTableBuilder } from "../../services/prismaDatatables";
import { VendasAcoes } from "./acoes";
import { Vendas } from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { formatCurrency } from "../../utils/formatters";
import { formatDate } from "date-fns";
import { ptBR } from "date-fns/locale";
import { isAccountOverdue } from "../../routers/web";
import { formatLabel } from "../../helpers/formatters";
import { hasPermission } from "../../helpers/userPermission";
export const tableVendas = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  if (await isAccountOverdue(req))
    return res.status(404).json({
      message: "Conta inativa ou bloqueada, verifique seu plano",
    });

  const permission = await hasPermission(customData, 3);
  const builder = new PrismaDataTableBuilder<Vendas>(prisma.vendas)
    .search({
      valor: "decimal",
    })
    .where({
      contaId: customData.contaId,
      status: req.query.status ? (req.query.status as string) : undefined,
      vendedorId: permission ? undefined : customData.userId,
    })
    .format("vendedorId", async function (value) {
      if (!value) return "-";
      const vendedor = await prisma.usuarios.findFirst({
        where: { id: value },
        select: { nome: true },
      });
      const nome = vendedor?.nome;
      return nome;
    })
    .format("clienteId", async function (value) {
      let nomeCliente = "-";
      if (value) {
        const vendedor = await prisma.clientesFornecedores.findUnique({
          where: { id: value },
          select: { nome: true },
        });
        nomeCliente = vendedor?.nome || "-";
      }

      return nomeCliente;
    })
    .edit("Uid", function (row) {
      const status = row.status;
      return `<span onclick="visualizarVenda('${row.id}')" class="px-2 py-1 flex flex-nowrap items-center justify-center gap-2 w-max border border-gray-700 text-gray-900 bg-gray-100 dark:border-gray-500 dark:bg-gray-950 dark:text-gray-100 rounded-md cursor-pointer">
              ${status === "FATURADO" ? '<i class="fa-solid fa-file-invoice-dollar text-green-500"></i>' : '<i class="fa-solid fa-file-invoice text-yellow-500"></i>'}${row.Uid}
            </span>`;
    })
    .format("data", function (row) {
      const data = formatDate(new Date(row), "dd/MM/yyyy", {
        locale: ptBR,
      });

      return formatLabel(data, "gray", "far fa-calendar-alt");
    })
    .format("status", function (status) {
      let color = "";

      switch (status) {
        case "ORCAMENTO":
          color = "yellow";
          break;
        case "FATURADO":
          color = "green";
          break;
        case "ANDAMENTO":
          color = "blue";
          break;
        case "FINALIZADO":
          color = "purple";
          break;
        case "PENDENTE":
          color = "orange";
          break;
        case "CANCELADO":
          color = "red";
          break;
      }

      return formatLabel(status, color, "fas fa-circle");
    })

    .format("valor", function (row) {
      return `<span class="px-2 py-1 rounded-md">${formatCurrency(row)}</span>`;
    })
    .addColumn("acoes", (row) => {
      return VendasAcoes(row);
    });
  const data = await builder.toJson(req.query);
  return res.json(data);
};
