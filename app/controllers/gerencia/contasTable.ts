import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { PrismaDataTableBuilder } from "../../services/prismaDatatables";
import { Contas } from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { isAccountOverdue } from "../../routers/web";
export const tableContasGerencia = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
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
    })
    .where({
      contaId: customData.contaId
    })
  const data = await builder.toJson(req.query);
  return res.json(data);
};
