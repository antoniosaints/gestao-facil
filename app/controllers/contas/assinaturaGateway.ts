import { Request, Response } from "express";
import { addDays, isBefore } from "date-fns";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";

import { getCustomRequest } from "../../helpers/getCustomRequest";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { env } from "../../utils/dotenv";
import { getContaNextRecurringValue } from "../../services/contas/storeModulesService";
import { mercadoPagoPreference } from "../../utils/mercadoPago";
import { AbacatePayService } from "../../services/financeiro/abacatePayService";
import { clearCacheAccount } from "../administracao/contas";
import {
  normalizePlatformGateway,
  type PlatformSaasGateway,
} from "../../services/contas/platformGatewayService";

function normalizeTaxId(value?: string | null) {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  return digits || undefined;
}

function normalizeCellphone(value?: string | null) {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  return digits ? `+55${digits}` : undefined;
}

function toAbacateCents(value: Decimal.Value) {
  return new Decimal(value || 0)
    .mul(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

async function getPendingSaasInvoice(contaId: number) {
  return prisma.faturasContas.findFirst({
    where: {
      contaId,
      status: {
        in: ["PENDENTE", "ATRASADO"],
      },
    },
    orderBy: {
      criadoEm: "desc",
    },
  });
}

async function createMercadoPagoCheckout(args: {
  contaId: number;
  nomeConta: string;
  email: string;
  documento?: string | null;
  recurringValue: Decimal;
}) {
  const payment = await mercadoPagoPreference.create({
    body: {
      items: [
        {
          id: randomUUID(),
          title: `${args.nomeConta} - Mensalidade Gestão Fácil - ERP`,
          quantity: 1,
          unit_price: args.recurringValue.toNumber(),
        },
      ],
      payer: {
        email: args.email,
        name: args.nomeConta,
        identification: args.documento
          ? {
              number: String(args.documento).replace(/[-.]/g, ""),
            }
          : undefined,
      },
      back_urls: {
        success: `${env.BASE_URL_FRONTEND}?success=true`,
        failure: `${env.BASE_URL_FRONTEND}?success=false`,
        pending: `${env.BASE_URL_FRONTEND}?success=pending`,
      },
      notification_url: `${env.BASE_URL}/mercadopago/webhook`,
      external_reference: String(args.contaId),
      auto_return: "approved",
    },
  });

  return payment.init_point;
}

async function createAbacatePayCheckout(args: {
  contaId: number;
  nomeConta: string;
  email: string;
  telefone?: string | null;
  documento?: string | null;
  recurringValue: Decimal;
  dueDate: Date;
}) {
  const existingPending = await getPendingSaasInvoice(args.contaId);
  if (existingPending?.urlPagamento) {
    return existingPending.urlPagamento;
  }

  if (!env.ABACATEPAY_API_KEY) {
    throw new Error(
      "AbacatePay não configurado no ambiente. Defina ABACATEPAY_API_KEY antes de usar esse gateway.",
    );
  }

  const abacate = new AbacatePayService(env.ABACATEPAY_API_KEY);
  const invoiceUid = gerarIdUnicoComMetaFinal("INV");
  const amountInCents = toAbacateCents(args.recurringValue);

  const customer = await abacate.createCustomer({
    email: args.email,
    name: args.nomeConta,
    taxId: normalizeTaxId(args.documento),
    cellphone: normalizeCellphone(args.telefone),
    metadata: {
      contaId: args.contaId,
      origem: "gestaofacil-saas",
    },
  });

  const product = await abacate.createProduct({
    externalId: `gf-saas-${args.contaId}-${invoiceUid}`,
    name: `Mensalidade Gestão Fácil - ${args.nomeConta}`,
    description: `Renovação da mensalidade do SaaS da conta ${args.nomeConta}`,
    price: amountInCents,
    currency: "BRL",
  });

  const checkout = await abacate.createCheckout({
    items: [
      {
        id: product.id,
        quantity: 1,
      },
    ],
    customerId: customer.id,
    methods: ["PIX", "CARD"],
    externalId: `conta:${args.contaId}|fatura:${invoiceUid}|saas`,
    completionUrl: `${env.BASE_URL_FRONTEND}?success=true`,
    returnUrl: `${env.BASE_URL_FRONTEND}?success=false`,
    metadata: {
      contaId: args.contaId,
      invoiceUid,
      origem: "gestaofacil-saas",
    },
  });

  await prisma.faturasContas.create({
    data: {
      contaId: args.contaId,
      Uid: invoiceUid,
      asaasPaymentId: checkout.id,
      descricao: "Mensalidade do plano Gestão Fácil (AbacatePay)",
      vencimento: args.dueDate,
      valor: args.recurringValue.toNumber(),
      urlPagamento: checkout.url,
      status: "PENDENTE",
    },
  });

  await clearCacheAccount(args.contaId);

  return checkout.url;
}

function getContaGateway(contaGateway?: string | null): PlatformSaasGateway {
  return normalizePlatformGateway(contaGateway);
}

export async function criarCheckoutAssinaturaConta(
  req: Request,
  res: Response,
): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const conta = await prisma.contas.findUniqueOrThrow({
      where: { id: customData.contaId },
    });

    const recurringValue = await getContaNextRecurringValue(conta.id);
    const gateway = getContaGateway(conta.gateway);

    const dueDate = isBefore(conta.vencimento, new Date())
      ? addDays(new Date(), 2)
      : conta.vencimento;

    if (gateway === "abacatepay") {
      if (!env.ABACATEPAY_API_KEY || !env.ABACATEPAY_WEBHOOK_SECRET) {
        return res.status(400).json({
          message:
            "AbacatePay não configurado no ambiente. Defina ABACATEPAY_API_KEY e ABACATEPAY_WEBHOOK_SECRET antes de gerar a cobrança.",
        });
      }

      const link = await createAbacatePayCheckout({
        contaId: conta.id,
        nomeConta: conta.nome,
        email: conta.email,
        telefone: conta.telefone,
        documento: conta.documento,
        recurringValue,
        dueDate,
      });

      return res.json({
        link,
        gateway,
        methods: ["PIX", "CARD"],
      });
    }

    const link = await createMercadoPagoCheckout({
      contaId: conta.id,
      nomeConta: conta.nome,
      email: conta.email,
      documento: conta.documento,
      recurringValue,
    });

    return res.json({
      link,
      gateway,
      methods: ["PIX"],
    });
  } catch (error) {
    return handleError(res, error);
  }
}
