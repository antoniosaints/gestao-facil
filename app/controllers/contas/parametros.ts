import { Request, Response } from "express";
import { handleError } from "../../utils/handleError";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";
import { updateParametrosContaSchema } from "../../schemas/contas";

export const saveParametros = async (req: Request, res: Response): Promise<any> => {
    try {
        const customData = getCustomRequest(req).customData;
        const body = updateParametrosContaSchema.safeParse(req.body);

        if (!body.success) {
            return res.status(400).json({
                status: 400,
                message: body.error.issues[0].message,
                data: null,
            });
        }
        
        const parametros = await prisma.parametrosConta.upsert({
            where: {
                contaId: customData.contaId
            }, 
            create: {
                contaId: customData.contaId,
                AsaasApiKey: body.data.AsaasApiKey,
                AsaasApiSecret: body.data.AsaasApiSecret,
                AsaasEnv: body.data.AsaasEnv,
                eventoEstoqueBaixo: body.data.eventoEstoqueBaixo,
                eventoSangria: body.data.eventoSangria,
                emailAvisos: body.data.emailAvisos,
                eventoVendaConcluida: body.data.eventoVendaConcluida,
                MercadoPagoApiKey: body.data.MercadoPagoApiKey,
                MercadoPagoEnv: body.data.MercadoPagoEnv,
            },
            update: {
                AsaasApiKey: body.data.AsaasApiKey,
                AsaasApiSecret: body.data.AsaasApiSecret,
                AsaasEnv: body.data.AsaasEnv,
                emailAvisos: body.data.emailAvisos,
                eventoEstoqueBaixo: body.data.eventoEstoqueBaixo,
                eventoSangria: body.data.eventoSangria,
                eventoVendaConcluida: body.data.eventoVendaConcluida,
                MercadoPagoApiKey: body.data.MercadoPagoApiKey,
                MercadoPagoEnv: body.data.MercadoPagoEnv, 
            }
        })

        return ResponseHandler(res, "Parametros salvos com sucesso!", parametros);
    }catch (err: any) {
        console.log(err);
        handleError(res, err);
    }
};

export const getParametros = async (req: Request, res: Response): Promise<any> => {
    try {
        const customData = getCustomRequest(req).customData;
        const parametros = await prisma.parametrosConta.findFirst({
            where: {
                contaId: customData.contaId
            }
        })
        return ResponseHandler(res, "Parametros encontrados!", parametros);
    }catch (err: any) {
        console.log(err);
        handleError(res, err);
    }
};