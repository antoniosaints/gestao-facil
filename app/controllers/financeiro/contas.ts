import { Request, Response } from "express";
import { ResponseHandler } from "../../utils/response";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { Prisma } from "../../../generated";
import { isAccountOverdue } from "../../routers/web";

export const listContasFinanceiro = async (req: Request, res: Response): Promise<any> => {
    try {
        const { contaId } = getCustomRequest(req).customData;

        const contas = await prisma.contasFinanceiro.findMany({
            where: {
                contaId,
            },
            select: {
                id: true,
                Uid: true,
                nome: true,
                saldoInicial: true,
            },
            orderBy: {
                nome: "asc",
            },
        });

        return ResponseHandler(res, "Contas listadas com sucesso!", contas, 200);
    } catch (error) {
        handleError(res, error);
    }
}

export const saveContaFinanceiro = async (req: Request, res: Response): Promise<any> => {
    try {
        const { contaId } = getCustomRequest(req).customData;

        if (!req.body) {
            return ResponseHandler(res, "Dados obrigatorio!", null, 400);
        }
        
        if (!req.body.nome) {
            return ResponseHandler(res, "Nome da conta obrigatorio!", null, 400);
        }

        if (req.body.id) {
            await prisma.contasFinanceiro.update({
                where: {
                    id: Number(req.body.id),
                    contaId
                },
                data: {
                    nome: req.body.nome,
                },
            });
        } else {
            await prisma.contasFinanceiro.create({
                data: {
                    contaId,
                    nome: req.body.nome,
                },
            });
        }

        return ResponseHandler(res, "Conta salva com sucesso!", null, 200);
    } catch (error) {
        handleError(res, error);
    }
}

export const deleteContaFinanceiro = async (req: Request, res: Response): Promise<any> => {
    try {
        const { id } = req.params;
        const { contaId } = getCustomRequest(req).customData;
        await prisma.contasFinanceiro.deleteMany({
            where: {
                id: Number(id),
                contaId,
            },
        });
        return ResponseHandler(res, "Conta deletada com sucesso!", null, 200);
    } catch (error) {
        handleError(res, error);
    }
}

export const tableContasFinanceiro = async (req: Request, res: Response): Promise<any> => {
    try {
        if (await isAccountOverdue(req)) {
            return res.status(404).json({
                message: "Conta inativa ou bloqueada, verifique seu plano",
            });
        }

        const { contaId } = getCustomRequest(req).customData;
        const page = parseInt(req.query.page as string) || 1;
        const pageSize = parseInt(req.query.pageSize as string) || 10;
        const search = (req.query.search as string) || "";
        const sortBy = (req.query.sortBy as string) || "nome";
        const order = req.query.order === "desc" ? "desc" : "asc";

        const where: Prisma.ContasFinanceiroWhereInput = {
            contaId,
        };

        if (search) {
            where.OR = [
                { nome: { contains: search } },
                { Uid: { contains: search } },
            ];
        }

        const orderBy: Prisma.ContasFinanceiroOrderByWithRelationInput[] = [];

        switch (sortBy) {
            case "id":
                orderBy.push({ id: order });
                break;
            case "Uid":
                orderBy.push({ Uid: order });
                break;
            case "saldoInicial":
                orderBy.push({ saldoInicial: order });
                break;
            default:
                orderBy.push({ nome: order });
                break;
        }

        orderBy.push({ id: "asc" });

        const total = await prisma.contasFinanceiro.count({ where });
        const data = await prisma.contasFinanceiro.findMany({
            where,
            select: {
                id: true,
                Uid: true,
                nome: true,
                saldoInicial: true,
            },
            orderBy,
            skip: (page - 1) * pageSize,
            take: pageSize,
        });

        return res.json({
            data,
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
        });
    } catch (error) {
        handleError(res, error);
    }
}
