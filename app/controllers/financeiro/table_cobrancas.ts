import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { Prisma } from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { isAccountOverdue } from "../../routers/web";

export const tableCobrancas = async (
  req: Request,
  res: Response
): Promise<any> => {
    try {
        const customData = getCustomRequest(req).customData;
        if (await isAccountOverdue(req)) {
          return res.status(404).json({
            message: "Conta inativa ou bloqueada, verifique seu plano",
          });
        }
      
        const page = parseInt(req.query.page as string) || 1;
        const pageSize = parseInt(req.query.pageSize as string) || 10;
        const search = (req.query.search as string) || "";
        const sortBy = (req.query.sortBy as string) || "dataVencimento";
        const order = req.query.order || "asc";
      
        const where: Prisma.CobrancasFinanceirasWhereInput = {
          contaId: customData.contaId,
        };
      
        if (search) {
          where.OR = [
            { Uid: { contains: search } },
            { idCobranca: { contains: search } },
            { gateway: { contains: search } },
            { observacao: { contains: search } },
          ];
        }
      
        const total = await prisma.cobrancasFinanceiras.count({ where });
        const data = await prisma.cobrancasFinanceiras.findMany({
          where,
          include: {
            Venda: true,
            LancamentoParcela: true,
            Ordemservico: true,
          },
          orderBy: { [sortBy]: order },
          skip: (page - 1) * pageSize,
          take: pageSize,
        });
      
        res.json({
          data,
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        });
    }catch (error) {
        console.log(error);
        res.status(500).json({ message: "Internal server error", error });
    }
};
