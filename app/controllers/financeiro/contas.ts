import { Request, Response } from "express";
import { ResponseHandler } from "../../utils/response";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";

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