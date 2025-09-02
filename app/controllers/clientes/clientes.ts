import { Request, Response } from "express";
import { ResponseHandler } from "../../utils/response";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { ClientesFornecedores } from "../../../generated";

export const getCliente = async (req: Request, res: Response): Promise<any> => {
    try {
        const { id } = req.params;
        const customData = getCustomRequest(req).customData;
        const cliente = await prisma.clientesFornecedores.findUnique({
            where: {
                id: Number(id),
                contaId: customData.contaId
            },
        });
        if (!cliente) {
            return ResponseHandler(res, "Cliente nao encontrado", null, 404);
        }
        ResponseHandler(res, "Cliente encontrado", cliente);
    } catch (err: any) {
        handleError(res, err);
    }
}

export const deleteCliente = async (req: Request, res: Response): Promise<any> => {
    try {
        const { id } = req.params;
        const customData = getCustomRequest(req).customData;
        const cliente = await prisma.clientesFornecedores.delete({
            where: {
                id: Number(id),
                contaId: customData.contaId
            },
        });
        ResponseHandler(res, "Cliente deletado", cliente);
    } catch (err: any) {
        handleError(res, err);
    }
}

export const saveCliente = async (req: Request, res: Response): Promise<any> => {
    try {
        const data = req.body as ClientesFornecedores;
        const customData = getCustomRequest(req).customData;
        if (!data || !data?.nome) {
            return ResponseHandler(res, "Dados nao informados", null, 400);
        }
        if (data.id) {
            const cliente = await prisma.clientesFornecedores.update({
                where: {
                    id: Number(data.id),
                },
                data: {
                    nome: data.nome,
                    cep: data.cep,
                    cidade: data.cidade,
                    estado: data.estado,
                    whastapp: data.whastapp,
                    email: data.email,
                    documento: data.documento,
                    endereco: data.endereco,
                    telefone: data.telefone,
                    status: data.status,
                    tipo: data.tipo,
                    observacaos: data.observacaos,
                }
            });
            return ResponseHandler(res, "Cliente atualizado", cliente);
        }else {
            const cliente = await prisma.clientesFornecedores.create({
                data: {
                    nome: data.nome,
                    cep: data.cep,
                    cidade: data.cidade,
                    contaId: customData.contaId,
                    estado: data.estado,
                    email: data.email,
                    whastapp: data.whastapp,
                    documento: data.documento,
                    endereco: data.endereco,
                    telefone: data.telefone,
                    status: data.status,
                    tipo: data.tipo,
                    observacaos: data.observacaos,
                    Uid: gerarIdUnicoComMetaFinal("CLI"),
                }
            });
            ResponseHandler(res, "Cliente criado", cliente);
        }
    } catch (err: any) {
        handleError(res, err);
    }
}