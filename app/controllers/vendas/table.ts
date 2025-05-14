import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { PrismaDataTableBuilder } from "../../services/prismaDatatables";
import { VendasAcoes } from "./acoes";
import { Vendas } from "../../../generated";
export const tableVendas = async (
  req: Request,
  res: Response
): Promise<any> => {
  const builder = new PrismaDataTableBuilder<Vendas>(prisma.vendas)
    .search({
      id: "number",
      clienteId: "number",
      data: "string",
      valor: "number",
    })
    .format("id", function(id) {
      return `<span class="px-2 py-0 flex flex-nowrap w-max text-primary bg-primary/20 rounded-md"># ${id}</span>`;
    })
    .format("clienteId", function(row) {
      const codigo = row || "-";
      return `<span class="px-2 py-0 text-blue-500 rounded-md">${codigo}</span>`;
    })
    .include(["id", "clienteId", "data", "valor", "createdAt"])
    .addColumn("acoes", (row) => {
      return VendasAcoes(row);
    });
  const data = await builder.toJson(req.query);
  return res.json(data);
};
