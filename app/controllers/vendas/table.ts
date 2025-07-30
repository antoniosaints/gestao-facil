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
export const tableVendas = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  if (await isAccountOverdue(req))
    return res.status(404).json({
      message: "Conta inativa ou bloqueada, verifique seu plano",
    });
  const builder = new PrismaDataTableBuilder<Vendas>(prisma.vendas)
    .search({
      valor: "decimal",
    })
    .where(
      {
        contaId: customData.contaId,
        status: req.query.status ? req.query.status as string : undefined
      }
    )
    .format("vendedorId", async function (value) {
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
      return `<span onclick="visualizarVenda('${row.id}')" class="px-2 py-1 flex flex-nowrap w-max border border-gray-700 text-gray-900 bg-gray-100 dark:border-gray-500 dark:bg-gray-950 dark:text-gray-100 rounded-md cursor-pointer">#${row.Uid}</span>`;
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
      return `<span class="px-2 py-1 text-blue-500 dark:text-blue-300 rounded-md">${formatCurrency(
        row
      )}</span>`;
    })
    .addColumn("acoes", (row) => {
      return VendasAcoes(row);
    });
  const data = await builder.toJson(req.query);
  return res.json(data);
};
