import { Request, Response } from "express";
import Decimal from "decimal.js";
import { isBefore } from "date-fns";
import { sendSessionUpdated } from "../../hooks/contas/socket";
import { formatDateToPtBR } from "../../helpers/formatters";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { syncContaSessionCaches } from "../../services/session/accountSessionCacheService";
import { handleError } from "../../utils/handleError";
import { redisConnecion } from "../../utils/redis";
import { ResponseHandler } from "../../utils/response";
import { prisma } from "../../utils/prisma";
import { isStoreModuleCharge } from "../../services/financeiro/chargeVisibilityService";
import { getContaRenovacaoBreakdown } from "../../services/contas/storeModulesService";

export const clearCacheAccount = async (contaId: number) => {
    await syncContaSessionCaches(contaId, { refreshUsers: true });
    sendSessionUpdated(contaId, {
        reason: "cache-conta-sincronizado",
        contaId,
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

        // Permite forçar dados 100% frescos (ex.: botão de atualizar da tela de resumo).
        // O cache continua sendo reconstruído logo abaixo, então só afeta esta requisição.
        const forceRefresh = req.query.refresh === "true" || req.query.refresh === "1";

        const cached = forceRefresh ? null : await redisConnecion.get(cacheKey);

        if (cached) {
            const cachedData = JSON.parse(cached);
            // Breakdown da renovação é sempre recalculado (crédito de indicação pode ter
            // mudado) para que o preview na tela de assinatura nunca fique defasado.
            cachedData.renovacao = await getContaRenovacaoBreakdown(customData.contaId);
            return ResponseHandler(res, "OK", cachedData, 200);
        }

        const conta = await prisma.contas.findUniqueOrThrow({
            where: { id: customData.contaId },
            include: {
                FaturasContas: {
                    orderBy: {
                        id: "desc",
                    },
                    take: 10,
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
            vencimento: formatDateToPtBR(fatura.vencimento),
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
                    vencimento: formatDateToPtBR(cobranca.dataVencimento),
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
            proximoVencimento: formatDateToPtBR(conta.vencimento),
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

        // Anexado após o cache (recalculado a cada request) — ver bloco de cache-hit acima.
        (data as any).renovacao = await getContaRenovacaoBreakdown(customData.contaId);

        ResponseHandler(res, "OK", data, 200);
    } catch (error: any) {
        handleError(res, error);
    }
}
