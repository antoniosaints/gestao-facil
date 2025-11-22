import { Request, Response } from "express"
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";
import { getCustomRequest } from "../../helpers/getCustomRequest";

export const getDashboardMain = async (req: Request, res: Response): Promise<any> => {
    try {
        const customData = getCustomRequest(req).customData;
        const usuario = await prisma.usuarios.findUniqueOrThrow({
            where: {
                id: customData.userId,
            },
        });
        if (!usuario || !usuario.superAdmin) {
            return res.status(403).json({
                message: "Usuário não tem permissão para visualizar esses dados.",
            });
        }
        const totalAssinantes = await prisma.contas.count();
        const inicio = new Date(new Date().setDate(new Date().getDate() - 90));
        const fim = new Date();
        const faturamento = await prisma.faturasContas.aggregate({
            where: {
                AND: [
                    {
                        criadoEm: {
                            gte: inicio,
                            lte: fim,
                        },
                    }
                ]  
            },
            _sum: {
                valor: true,
            },
        })
        const proximosVencimentos = await prisma.faturasContas.findMany({
            where: {
                AND: [
                    {
                        vencimento: {
                            gte: new Date(),
                        },
                    }
                ]  
            },
            select: {
                valor: true,
                urlPagamento: true,
                id: true,
                contaId: true,
                conta: {
                    select: {
                        nome: true,
                    }
                }
            },
            orderBy: {
                criadoEm: "asc",
            }
        })

        const totalAReceber = await prisma.faturasContas.aggregate({
            where: {
                status: "PENDENTE"
            },
            _sum: {
                valor: true,
            },
        })

        const responseData = {
            totalAssinantes,
            faturamento: faturamento._sum?.valor || 0,
            totalAReceber: totalAReceber._sum?.valor || 0,
            proximosVencimentos: {
                quantidade: proximosVencimentos.length,
                faturas: proximosVencimentos
            },
        }

        return ResponseHandler(res, "Dashboard", responseData);
    }catch (err: any) {
        handleError(res, err);
    }
}