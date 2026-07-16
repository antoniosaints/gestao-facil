import { Request, Response } from "express";
import { addDays, isBefore } from "date-fns";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";

import { getCustomRequest } from "../../helpers/getCustomRequest";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { env } from "../../utils/dotenv";
import {
  getContaEffectiveRecurringValue,
  getContaRenovacaoBreakdown,
  reconcileStoreModulesAfterPayment,
  consumirCreditoIndicacaoNoPagamento,
} from "../../services/contas/storeModulesService";
import { mercadoPagoPreference } from "../../utils/mercadoPago";
import { AbacatePayService } from "../../services/financeiro/abacatePayService";
import { clearCacheAccount } from "../administracao/contas";
import { clearContaStatusCache } from "../../services/session/accountSessionCacheService";
import { redisConnecion } from "../../utils/redis";
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
  dueDate: Date;
}) {
  // Guard: se já existe uma fatura de mensalidade pendente com o MESMO valor, reaproveita
  // o link em vez de gerar uma nova cobrança (evita duplicar cobrança no Mercado Pago).
  const pendente = await getPendingSaasInvoice(args.contaId);
  if (pendente?.urlPagamento && new Decimal(pendente.valor).equals(args.recurringValue)) {
    return pendente.urlPagamento;
  }
  // Se o valor mudou (ex.: crédito de indicação aplicado), cancela a pendente antiga
  // para não deixar dois links de valores diferentes em aberto.
  if (pendente) {
    await prisma.faturasContas.update({
      where: { id: pendente.id },
      data: { status: "CANCELADO" },
    });
  }

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

  // Persiste a fatura pendente (chaveada pelo id da preferência) para que o guard acima
  // possa reaproveitá-la. O webhook de pagamento a reconcilia (ver mercadopago/webhook.ts).
  await prisma.faturasContas.create({
    data: {
      contaId: args.contaId,
      Uid: gerarIdUnicoComMetaFinal("INV"),
      asaasPaymentId: String(payment.id ?? gerarIdUnicoComMetaFinal("MP")),
      descricao: "Mensalidade do plano Gestão Fácil (Mercado Pago)",
      vencimento: args.dueDate,
      valor: args.recurringValue.toNumber(),
      urlPagamento: payment.init_point ?? "",
      status: "PENDENTE",
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

    const recurringValue = await getContaEffectiveRecurringValue(conta.id);
    const gateway = getContaGateway(conta.gateway);

    // Se o crédito de indicação cobre toda a mensalidade, não há o que cobrar no gateway.
    // O fluxo correto é a renovação grátis (POST /contas/assinatura/renovar-gratis).
    if (recurringValue.lte(0)) {
      return res.status(400).json({
        message:
          "Sua mensalidade está totalmente coberta pelo saldo de indicação. Use a renovação grátis.",
        renovarGratis: true,
      });
    }

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

      // Gerar a cobrança altera as faturas da conta; invalida o cache do status
      // (assinaturaconta:conta{id}) para a tela de resumo não exibir dados defasados
      // quando o usuário voltar do gateway.
      await clearContaStatusCache(conta.id);

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
      dueDate,
    });

    // Gerar a cobrança altera as faturas da conta; invalida o cache do status
    // (assinaturaconta:conta{id}) para a tela de resumo não exibir dados defasados
    // quando o usuário voltar do gateway.
    await clearContaStatusCache(conta.id);

    return res.json({
      link,
      gateway,
      methods: ["PIX"],
    });
  } catch (error) {
    return handleError(res, error);
  }
}

// Renova a mensalidade usando exclusivamente o saldo de indicação, quando ele cobre
// TODO o valor. Não gera cobrança em gateway. A elegibilidade é validada no servidor
// (nunca confie no cliente) para não abrir furo de caixa.
export async function renovarAssinaturaGratis(
  req: Request,
  res: Response,
): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const contaId = customData.contaId as number;

    const breakdown = await getContaRenovacaoBreakdown(contaId);

    if (!breakdown.cobreTotalmente) {
      return res.status(400).json({
        message:
          "Seu saldo de indicação não cobre toda a mensalidade. Gere o pagamento da diferença.",
      });
    }

    const conta = await prisma.contas.findUniqueOrThrow({
      where: { id: contaId },
      select: { id: true, vencimento: true },
    });

    const hoje = new Date();
    const vencimentoAtual = conta.vencimento;
    const vencimentoNovo = isBefore(vencimentoAtual, hoje)
      ? addDays(hoje, 30)
      : addDays(vencimentoAtual, 30);

    // Comprovante da renovação coberta pelo crédito (fatura PAGA de valor 0).
    await prisma.faturasContas.create({
      data: {
        contaId,
        Uid: gerarIdUnicoComMetaFinal("INV"),
        asaasPaymentId: gerarIdUnicoComMetaFinal("FREE"),
        urlPagamento: "",
        descricao: "Renovação coberta pelo saldo de indicação",
        vencimento: vencimentoNovo,
        valor: 0,
        status: "PAGO",
      },
    });

    await prisma.contas.update({
      where: { id: contaId },
      data: { status: "ATIVO", vencimento: vencimentoNovo },
    });

    // Consome o crédito exatamente como num pagamento (valorPago = 0 → abate o subtotal
    // do saldo) e reconcilia os apps (ativa pendentes / estende ativos).
    await consumirCreditoIndicacaoNoPagamento(contaId, 0);
    await reconcileStoreModulesAfterPayment(contaId, vencimentoAtual, vencimentoNovo);

    // Nota: a recompensa ao indicador NÃO é concedida aqui — ela depende de um
    // pagamento real do indicado; uma renovação 100% coberta por crédito não gera receita.

    await redisConnecion.del(`assinaturaconta:conta${contaId}`);
    await clearCacheAccount(contaId);

    return res.json({
      message: "Assinatura renovada com seu saldo de indicação.",
      vencimento: vencimentoNovo,
      breakdown,
    });
  } catch (error) {
    return handleError(res, error);
  }
}
