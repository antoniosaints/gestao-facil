import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";
import Decimal from "decimal.js";
import { handleError } from "../../utils/handleError";
import { isBefore } from "date-fns";
import { redisConnecion } from "../../utils/redis";

export const clearCacheAccount = async (contaId: number) => {
    await redisConnecion.del(`assinaturaconta:conta${contaId}`);
    await redisConnecion.del(`infoconta:conta${contaId}`);
}

function isStoreModuleCharge(observacao?: string | null) {
    if (!observacao) return false;

    return [
        "App Store",
        "Liberacao proporcional do app",
        "Primeira mensalidade do app",
    ].some((pattern) => observacao.includes(pattern));
}

function formatDatePtBR(date: Date) {
    return date.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    });
}

function normalizeChargeStatus(status: string) {
    if (status === "EFETIVADO") return "PAGO";
    if (status === "ESTORNADO") return "CANCELADO";
    return status;
}

export const assinaturaConta = async (req: Request, res: Response): Promise<any> => {
    try {
        const customData = getCustomRequest(req).customData;

        const cacheKey = `assinaturaconta:conta${customData.contaId}`;

        const cached = await redisConnecion.get(cacheKey);

        if (cached) {
            return ResponseHandler(res, "OK", JSON.parse(cached), 200);
        }

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
        const cobrancasApps = await prisma.cobrancasFinanceiras.findMany({
            where: {
                contaId: customData.contaId,
                OR: [
                    { observacao: { contains: "App Store" } },
                    { observacao: { contains: "Liberacao proporcional do app" } },
                    { observacao: { contains: "Primeira mensalidade do app" } },
                ],
            },
            orderBy: {
                dataCadastro: "desc",
            },
            take: 10,
        });

        const faturasMensalidade = conta.FaturasContas.map((fatura) => ({
            asaasPaymentId: fatura.asaasPaymentId,
            vencimento: formatDatePtBR(fatura.vencimento),
            valor: fatura.valor,
            status: fatura.status,
            linkPagamento: fatura.urlPagamento,
            id: `mensalidade-${fatura.id}`,
            color: fatura.status === "PENDENTE" ? "orange" : fatura.status === "PAGO" ? "green" : "red",
            origem: "MENSALIDADE",
            descricao: fatura.descricao || "Mensalidade do plano",
            criadoEm: fatura.criadoEm,
        }));

        const faturasApps = cobrancasApps
            .filter((cobranca) => isStoreModuleCharge(cobranca.observacao))
            .map((cobranca) => {
                const status = normalizeChargeStatus(cobranca.status);

                return {
                    asaasPaymentId: cobranca.idCobranca,
                    vencimento: formatDatePtBR(cobranca.dataVencimento),
                    valor: new Decimal(cobranca.valor).toNumber(),
                    status,
                    linkPagamento: cobranca.externalLink,
                    id: `app-${cobranca.id}`,
                    color: status === "PENDENTE" ? "orange" : status === "PAGO" ? "green" : "red",
                    origem: "APP",
                    descricao: cobranca.observacao || "Cobranca de app",
                    criadoEm: cobranca.dataCadastro,
                };
            });

        const faturasCombinadas = [...faturasMensalidade, ...faturasApps]
            .sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime())
            .slice(0, 10);

        const proximaCobrancaPendente = [...faturasCombinadas]
            .filter((fatura) => fatura.status === "PENDENTE" && !!fatura.linkPagamento)
            .sort((a, b) => {
                const [dayA, monthA, yearA] = a.vencimento.split("/").map(Number);
                const [dayB, monthB, yearB] = b.vencimento.split("/").map(Number);
                return new Date(yearA, monthA - 1, dayA).getTime() - new Date(yearB, monthB - 1, dayB).getTime();
            })[0] || null;

        const data = {
            status: isBefore(conta.vencimento, new Date()) ? "INATIVO" : "ATIVO",
            valor: conta.valor ? `R$ ${new Decimal(conta.valor).toFixed(2).replace('.', ',')}` : "R$ 0,00",
            faturas: faturasCombinadas,
            diasParaVencer: (conta.vencimento.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24),
            proximoVencimento: formatDatePtBR(conta.vencimento),
            valorTotal: faturasCombinadas.reduce((acc, val) => acc.plus(val.valor), new Decimal(0)),
            valorPendente: faturasCombinadas.filter((fatura) => fatura.status === "PENDENTE").reduce((acc, val) => acc.plus(val.valor), new Decimal(0)),
            valorPago: faturasCombinadas.filter((fatura) => fatura.status === "PAGO").reduce((acc, val) => acc.plus(val.valor), new Decimal(0)),
            valorCancelado: faturasCombinadas.filter((fatura) => fatura.status === "CANCELADO").reduce((acc, val) => acc.plus(val.valor), new Decimal(0)),
            proximoLinkPagamento: proximaCobrancaPendente?.linkPagamento || null,
            labelAssinatura: proximaCobrancaPendente?.origem === "APP"
                ? "App com cobranca pendente"
                : conta.status === "ATIVO"
                    ? "Assinatura em dias"
                    : "Fatura pendente",
        }

        await redisConnecion.set(cacheKey, JSON.stringify(data), "EX", 3600);

        ResponseHandler(res, "OK", data, 200);
    } catch (error: any) {
        handleError(res, error);
    }
}
