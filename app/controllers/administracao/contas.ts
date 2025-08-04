import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";
import Decimal from "decimal.js";
import { handleError } from "../../utils/handleError";
import { isBefore } from "date-fns";

export const assinaturaConta = async (req: Request, res: Response) => {
    try {
        const customData = getCustomRequest(req).customData;

        const conta = await prisma.contas.findUniqueOrThrow({
            where: { id: customData.contaId },
            include: {
                FaturasContas: {
                    orderBy: {
                        id: "desc",
                    },
                    take: 10
                },
            },
        });

        const data = {
            status: isBefore(conta.vencimento, new Date()) ? "INATIVO" : "ATIVO",
            valor: conta.valor ? `R$ ${new Decimal(conta.valor).toFixed(2).replace('.', ',')}` : "R$ 0,00",
            faturas: conta.FaturasContas.map((fatura) => ({
                asaasPaymentId: fatura.asaasPaymentId,
                vencimento: fatura.vencimento.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }),
                valor: fatura.valor ? fatura.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "R$ 0,00",
                status: fatura.status,
                linkPagamento: fatura.urlPagamento,
                id: fatura.id,
                color: fatura.status === "PENDENTE" ? "orange" : fatura.status === "PAGO" ? "green" : "red",
            })),
            diasParaVencer: (conta.vencimento.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24),
            proximoVencimento: conta.vencimento.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }),
            valorTotal: conta.FaturasContas.reduce((acc, val) => acc.plus(val.valor), new Decimal(0)),
            valorPendente: conta.FaturasContas.filter((fatura) => fatura.status === "PENDENTE").reduce((acc, val) => acc.plus(val.valor), new Decimal(0)),
            valorPago: conta.FaturasContas.filter((fatura) => fatura.status === "PAGO").reduce((acc, val) => acc.plus(val.valor), new Decimal(0)),
            valorCancelado: conta.FaturasContas.filter((fatura) => fatura.status === "CANCELADO").reduce((acc, val) => acc.plus(val.valor), new Decimal(0)),
            proximoLinkPagamento: conta.FaturasContas.filter((fatura) => fatura.status === "PENDENTE").slice(-1)[0]?.urlPagamento || null,
            labelAssinatura: conta.status === "ATIVO" ? "Assinatura em dias" : "Fatura pendente",
        }

        ResponseHandler(res, "OK", data, 200);
    } catch (error: any) {
        handleError(res, error);
    }
}