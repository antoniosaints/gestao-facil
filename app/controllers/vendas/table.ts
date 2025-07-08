import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { PrismaDataTableBuilder } from "../../services/prismaDatatables";
import { VendasAcoes } from "./acoes";
import { Vendas } from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { formatCurrency } from "../../utils/formatters";
export const tableVendas = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  if (customData.contaStatus !== "ATIVO")
    return res.status(404).json({
      message: "Conta inativa ou bloqueada, verifique seu plano",
    });
  const builder = new PrismaDataTableBuilder<Vendas>(prisma.vendas)
    .search({
      valor: "decimal",
    })
    .where(
      req.query.status
        ? {
            OR: [
              {
                status: req.query.status as string,
              },
            ],
          }
        : {}
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
    .format("id", function (id) {
      return `<span class="px-2 py-1 flex flex-nowrap w-max text-primary bg-primary/20 rounded-md"># ${id}</span>`;
    })
    .format("data", function (row) {
      const data = new Date(row).toLocaleDateString("pt-BR");
      return `<span class="px-2 py-1 dark:bg-gray-600 bg-gray-200  rounded-md">${data}</span>`;
    })
    .format("status", function (status) {
      const colors: Record<string, { light: string; dark: string }> = {
        ORCAMENTO: {
          light: "bg-yellow-200 text-yellow-800",
          dark: "dark:bg-yellow-700 dark:text-yellow-300",
        },
        FATURADO: {
          light: "bg-green-200 text-green-800",
          dark: "dark:bg-green-700 dark:text-green-300",
        },
        ANDAMENTO: {
          light: "bg-blue-200 text-blue-800",
          dark: "dark:bg-blue-700 dark:text-blue-300",
        },
        FINALIZADO: {
          light: "bg-purple-200 text-purple-800",
          dark: "dark:bg-purple-700 dark:text-purple-300",
        },
        PENDENTE: {
          light: "bg-orange-200 text-orange-800",
          dark: "dark:bg-orange-700 dark:text-orange-300",
        },
        CANCELADO: {
          light: "bg-red-200 text-red-800",
          dark: "dark:bg-red-700 dark:text-red-300",
        },
      };

      const color = colors[status] || {
        light: "bg-gray-200 text-gray-800",
        dark: "dark:bg-gray-700 dark:text-gray-300",
      };

      return `<span class="px-2 py-1 rounded-md ${color.light} ${color.dark}">${status}</span>`;
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
