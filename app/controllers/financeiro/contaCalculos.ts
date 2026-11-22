import type { RequestHandler } from "express";
import { z } from "zod";
import type { PrismaClient } from "../../../generated";
import { getCustomRequest, type CustomData } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { ResponseHandler } from "../../utils/response";

const calculosSchema = z.object({ ignorarNosCalculos: z.boolean() }).strict();

export function atualizarCalculosContaFinanceira(
    db: Pick<PrismaClient, "contasFinanceiro">,
    hasPermission: (session: CustomData, level: number) => Promise<boolean>,
    notify: (contaId: number, contaFinanceiraId: number) => void,
): RequestHandler {
    return async (req, res) => {
        try {
            const session = getCustomRequest(req).customData;
            if (!session?.contaId) {
                return void ResponseHandler(res, "Sessão obrigatória.", null, 401);
            }

            if (!session.impersonacao && !(await hasPermission(session, 3))) {
                return void ResponseHandler(res, "Você não tem permissão para editar os cálculos desta conta.", null, 403);
            }

            const id = Number(req.params.id);
            const input = calculosSchema.safeParse(req.body);
            if (!Number.isSafeInteger(id) || id <= 0 || !input.success) {
                return void ResponseHandler(res, "Informe uma conta financeira e uma opção de cálculo válidas.", null, 400);
            }

            const { count } = await db.contasFinanceiro.updateMany({
                where: { id, contaId: session.contaId },
                data: input.data,
            });
            if (!count) {
                return void ResponseHandler(res, "Conta financeira não encontrada.", null, 404);
            }

            try {
                notify(session.contaId, id);
            } catch (error) {
                console.warn("[financeiro] Preferência de cálculo salva; socket indisponível.", error);
            }

            return void ResponseHandler(res, "Participação nos cálculos atualizada.", { id, ...input.data });
        } catch (error) {
            handleError(res, error);
        }
    };
}
