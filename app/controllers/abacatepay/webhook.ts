import { Request, Response } from "express";
import { addDays, isBefore } from "date-fns";
import Decimal from "decimal.js";

import { MetodoPagamento, StatusPagamento } from "../../../generated";
import { prisma } from "../../utils/prisma";
import { handleError } from "../../utils/handleError";
import {
  AbacatePayService,
  type AbacatePayWebhookPayload,
} from "../../services/financeiro/abacatePayService";
import { reconcileStoreModulesAfterPayment } from "../../services/contas/storeModulesService";
import { clearCacheAccount } from "../administracao/contas";
import { env } from "../../utils/dotenv";
import { atualizarStatusLancamentos } from "../financeiro/hooks";
import { sendUpdateTable } from "../../hooks/vendas/socket";
import { recalculateComandaStatus } from "../vendas/comandas";
import { syncCycleStatusFromCharge } from "../../services/assinaturas/recorrenciaService";
import { sendFinanceiroUpdated } from "../../hooks/financeiro/socket";

type WebhookResource = {
  id?: string;
  externalId?: string | null;
  url?: string | null;
  receiptUrl?: string | null;
  amount?: number | null;
  paidAmount?: number | null;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
  brCode?: string | null;
  barCode?: string | null;
};

type CheckoutWebhookData = {
  checkout?: WebhookResource;
  transparent?: WebhookResource;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function parseNumericId(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function extractContaInfo(externalId?: string | null) {
  if (!externalId) return { contaId: null, invoiceUid: null, chargeUid: null };

  const contaMatch = externalId.match(/conta:(\d+)/i);
  const faturaMatch = externalId.match(/fatura:([^|]+)/i);
  const chargeMatch = externalId.match(/cobranca:([^|]+)/i);

  return {
    contaId: contaMatch ? Number(contaMatch[1]) : null,
    invoiceUid: faturaMatch?.[1] || null,
    chargeUid: chargeMatch?.[1] || null,
  };
}

function resolveWebhookResource(data: CheckoutWebhookData, event?: string | null) {
  if (isRecord(data.checkout)) {
    return { kind: "checkout" as const, resource: data.checkout as WebhookResource };
  }

  if (isRecord(data.transparent)) {
    return { kind: "transparent" as const, resource: data.transparent as WebhookResource };
  }

  if (event?.startsWith("transparent.") && isRecord(data)) {
    return { kind: "transparent" as const, resource: data as WebhookResource };
  }

  if (isRecord(data)) {
    return { kind: "checkout" as const, resource: data as WebhookResource };
  }

  return null;
}

function extractWebhookContext(args: {
  event?: string | null;
  resource: WebhookResource;
  data: CheckoutWebhookData;
}) {
  const metadata = isRecord(args.resource.metadata)
    ? args.resource.metadata
    : isRecord(args.data.metadata)
      ? args.data.metadata
      : {};

  const externalInfo = extractContaInfo(args.resource.externalId);
  const contaId =
    parseNumericId(metadata.contaId) ||
    externalInfo.contaId ||
    parseNumericId(metadata.conta) ||
    null;

  const invoiceUid =
    typeof metadata.invoiceUid === "string" && metadata.invoiceUid
      ? metadata.invoiceUid
      : externalInfo.invoiceUid;

  const chargeUid =
    typeof metadata.cobrancaUid === "string" && metadata.cobrancaUid
      ? metadata.cobrancaUid
      : externalInfo.chargeUid;

  const origem =
    typeof metadata.origem === "string" && metadata.origem
      ? metadata.origem
      : invoiceUid || args.resource.externalId?.includes("|saas")
        ? "gestaofacil-saas"
        : chargeUid
          ? "gestaofacil-financeiro"
          : null;

  return {
    contaId,
    invoiceUid,
    chargeUid,
    origem,
    scope: origem === "gestaofacil-saas" ? "saas" : "tenant",
  } as const;
}

function mapWebhookEventToInvoiceStatus(event: string, resourceStatus?: string | null) {
  if (
    event === "checkout.completed" ||
    resourceStatus === "PAID"
  ) {
    return "PAGO" as const;
  }

  if (
    [
      "checkout.refunded",
      "checkout.disputed",
      "checkout.lost",
      "transparent.refunded",
      "transparent.disputed",
      "transparent.lost",
    ].includes(event) ||
    ["CANCELLED", "REFUNDED", "EXPIRED"].includes(String(resourceStatus || ""))
  ) {
    return "CANCELADO" as const;
  }

  return "PENDENTE" as const;
}

function mapWebhookEventToChargeStatus(event: string, resourceStatus?: string | null) {
  if (
    event === "checkout.completed" ||
    event === "transparent.completed" ||
    resourceStatus === "PAID"
  ) {
    return "EFETIVADO" as const;
  }

  if (
    event === "checkout.refunded" ||
    event === "transparent.refunded" ||
    resourceStatus === "REFUNDED"
  ) {
    return "ESTORNADO" as const;
  }

  if (
    [
      "checkout.disputed",
      "checkout.lost",
      "transparent.disputed",
      "transparent.lost",
    ].includes(event) ||
    ["CANCELLED", "EXPIRED"].includes(String(resourceStatus || ""))
  ) {
    return "CANCELADO" as const;
  }

  return "PENDENTE" as const;
}

function centsToReais(value?: number | null) {
  return new Decimal(value || 0).div(100).toNumber();
}

async function resolveWebhookSecret(scope: "saas" | "tenant", contaId: number) {
  if (scope === "saas") {
    return env.ABACATEPAY_WEBHOOK_SECRET || null;
  }

  const parametros = await prisma.parametrosConta.findUnique({
    where: { contaId },
    select: { AbacatePaySecret: true },
  });

  return parametros?.AbacatePaySecret || null;
}

async function handleSaasWebhook(args: {
  event: string;
  resource: WebhookResource;
  contaId: number;
  invoiceUid?: string | null;
}) {
  const conta = await prisma.contas.findUniqueOrThrow({
    where: { id: args.contaId },
    select: {
      id: true,
      vencimento: true,
    },
  });

  const nextStatus = mapWebhookEventToInvoiceStatus(args.event, args.resource.status);
  const paymentUrl = args.resource.receiptUrl || args.resource.url || "";
  const invoiceValue = centsToReais(args.resource.paidAmount ?? args.resource.amount);

  const existingInvoice = await prisma.faturasContas.findUnique({
    where: { asaasPaymentId: args.resource.id! },
  });

  if (existingInvoice?.status === "PAGO" && nextStatus === "PAGO") {
    return;
  }

  await (existingInvoice
    ? prisma.faturasContas.update({
        where: { id: existingInvoice.id },
        data: {
          status: nextStatus,
          valor: invoiceValue || existingInvoice.valor,
          urlPagamento: paymentUrl || existingInvoice.urlPagamento,
          descricao:
            existingInvoice.descricao ||
            "Mensalidade do plano Gestão Fácil (AbacatePay)",
        },
      })
    : prisma.faturasContas.create({
        data: {
          contaId: args.contaId,
          Uid: args.invoiceUid || `INV_ABA_${args.resource.id}`,
          asaasPaymentId: args.resource.id!,
          descricao: "Mensalidade do plano Gestão Fácil (AbacatePay)",
          vencimento: conta.vencimento,
          valor: invoiceValue,
          urlPagamento: paymentUrl,
          status: nextStatus,
        },
      }));

  if (nextStatus === "PAGO") {
    const previousDueDate = conta.vencimento;
    const hoje = new Date();
    const novoVencimento = isBefore(previousDueDate, hoje)
      ? addDays(hoje, 30)
      : addDays(previousDueDate, 30);

    await prisma.contas.update({
      where: { id: args.contaId },
      data: {
        status: "ATIVO",
        vencimento: novoVencimento,
      },
    });

    await reconcileStoreModulesAfterPayment(
      args.contaId,
      previousDueDate,
      novoVencimento,
    );
    await clearCacheAccount(args.contaId);
    return;
  }

  if (nextStatus === "CANCELADO") {
    await clearCacheAccount(args.contaId);
  }
}

async function handleTenantWebhook(args: {
  event: string;
  resource: WebhookResource;
  resourceKind: "checkout" | "transparent";
  contaId: number;
  chargeUid?: string | null;
}) {
  const whereClauses: Array<Record<string, unknown>> = [{
    idCobranca: args.resource.id,
  }];

  if (args.chargeUid) {
    whereClauses.push({ Uid: args.chargeUid });
  }

  let cobranca = await prisma.cobrancasFinanceiras.findFirst({
    include: { cobrancasOnAgendamentos: true },
    where: {
      contaId: args.contaId,
      gateway: "abacatepay",
      OR: whereClauses,
    },
  });

  if (!cobranca) {
    return;
  }

  const statusNovo = mapWebhookEventToChargeStatus(args.event, args.resource.status);
  const paymentLink =
    args.resource.receiptUrl ||
    args.resource.url ||
    args.resource.brCode ||
    args.resource.barCode ||
    cobranca.externalLink ||
    null;

  if (cobranca.idCobranca !== args.resource.id || cobranca.externalLink !== paymentLink || cobranca.status !== statusNovo) {
    cobranca = await prisma.cobrancasFinanceiras.update({
      where: { id: cobranca.id },
      data: {
        idCobranca: args.resource.id!,
        externalLink: paymentLink,
        status: statusNovo,
      },
      include: { cobrancasOnAgendamentos: true },
    });
  }

  if (statusNovo === "EFETIVADO") {
    await syncCycleStatusFromCharge(cobranca.id, "PAGO");
  } else if (["CANCELADO", "ESTORNADO"].includes(statusNovo)) {
    await syncCycleStatusFromCharge(cobranca.id, "CANCELADO");
  }

  if (statusNovo !== "EFETIVADO") {
    return;
  }

  const metodoPago: MetodoPagamento =
    args.resourceKind === "transparent" ? "PIX" : "GATEWAY";

  if (
    cobranca.cobrancasOnAgendamentos &&
    cobranca.cobrancasOnAgendamentos.length > 0
  ) {
    const promises = cobranca.cobrancasOnAgendamentos.map(async (reserva) => {
      const agendamento = await prisma.arenaAgendamentos.update({
        where: {
          id: reserva.agendamentoId,
          Quadra: { contaId: cobranca.contaId },
        },
        data: {
          status: "CONFIRMADA",
        },
      });
      return prisma.arenaAgendamentosPagamentos.create({
        data: {
          agendamentoId: agendamento.id,
          valor: cobranca.valor,
          metodoPagamento: metodoPago,
          dataPagamento: new Date(),
          tipo: cobranca.valor < agendamento.valor ? "PARCIAL" : "TOTAL",
        },
      });
    });

    await Promise.all(promises);
  }

  if (cobranca.lancamentoId) {
    await prisma.parcelaFinanceiro.update({
      where: { id: cobranca.lancamentoId },
      data: {
        pago: true,
        dataPagamento: new Date(),
        formaPagamento: metodoPago,
      },
    });
    await atualizarStatusLancamentos(cobranca.contaId);
    sendFinanceiroUpdated(cobranca.contaId, {
      reason: "cobranca-liquidada-webhook",
      parcelaId: cobranca.lancamentoId,
    });
  }

  if (cobranca.reservaId) {
    const pagamentoReserva = await prisma.arenaAgendamentos.update({
      where: {
        id: cobranca.reservaId,
        Quadra: { contaId: cobranca.contaId },
      },
      data: {
        status: "CONFIRMADA",
      },
    });
    await prisma.arenaAgendamentosPagamentos.create({
      data: {
        agendamentoId: pagamentoReserva.id,
        valor: cobranca.valor,
        metodoPagamento: metodoPago,
        dataPagamento: new Date(),
        tipo: cobranca.valor < pagamentoReserva.valor ? "PARCIAL" : "TOTAL",
      },
    });
  }

  if (cobranca.vendaId) {
    const venda = await prisma.vendas.findUniqueOrThrow({
      where: { id: cobranca.vendaId, contaId: cobranca.contaId },
    });
    await prisma.vendas.update({
      where: { id: cobranca.vendaId },
      data: {
        faturado: true,
        status: "FATURADO",
        PagamentoVendas: {
          upsert: {
            where: { vendaId: cobranca.vendaId },
            create: {
              valor: venda.valor,
              data: new Date(),
              metodo: metodoPago,
              status: "EFETIVADO",
            },
            update: {
              metodo: metodoPago,
              data: new Date(),
              status: "EFETIVADO",
            },
          },
        },
      },
    });

    await sendUpdateTable(cobranca.contaId, {
      message: `A venda ${venda.Uid} foi efetivada`,
    });

    if (venda.comandaId) {
      await recalculateComandaStatus(
        prisma,
        venda.comandaId,
        cobranca.contaId,
      );
    }
  }
}

export async function webhookAbacatePay(
  req: Request,
  res: Response,
): Promise<any> {
  try {
    const rawBody = (req as any).rawBody as string | undefined;
    const signature = req.header("x-webhook-signature");
    const payload = req.body as AbacatePayWebhookPayload<CheckoutWebhookData>;
    const event = payload?.event;
    const data = payload?.data;

    if (!rawBody || !event || !data) {
      return res.sendStatus(204);
    }

    const resolvedResource = resolveWebhookResource(data, event);
    if (!resolvedResource?.resource?.id) {
      return res.sendStatus(204);
    }

    const context = extractWebhookContext({
      event,
      resource: resolvedResource.resource,
      data,
    });

    if (!context.contaId) {
      return res.sendStatus(204);
    }

    const signingSecret = await resolveWebhookSecret(context.scope, context.contaId);
    if (!signingSecret) {
      return res.status(401).json({
        error: "Secret do webhook AbacatePay não configurado para este contexto.",
      });
    }

    if (
      !AbacatePayService.verifyWebhookSignature(rawBody, signingSecret, signature)
    ) {
      return res.status(401).json({
        error: "Assinatura do webhook AbacatePay inválida.",
      });
    }

    if (context.scope === "saas") {
      await handleSaasWebhook({
        event,
        resource: resolvedResource.resource,
        contaId: context.contaId,
        invoiceUid: context.invoiceUid,
      });
      return res.sendStatus(200);
    }

    await handleTenantWebhook({
      event,
      resource: resolvedResource.resource,
      resourceKind: resolvedResource.kind,
      contaId: context.contaId,
      chargeUid: context.chargeUid,
    });

    return res.sendStatus(200);
  } catch (error) {
    return handleError(res, error);
  }
}
