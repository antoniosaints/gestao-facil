import Decimal from "decimal.js";

import { Prisma, type ParametrosConta } from "../../../../generated";
import { gerarIdUnicoComMetaFinal } from "../../../helpers/generateUUID";
import { prisma } from "../../../utils/prisma";
import { AbacatePayService } from "../../../services/financeiro/abacatePayService";
import type { BodyCobranca } from "../cobrancas";
import type { GeneratedChargeResult } from "../mercadoPago/gerarCobranca";
import { assertChargeCreationAllowed } from "../../../services/financeiro/financeiroPolicyService";

type PrismaExecutor = Prisma.TransactionClient | typeof prisma;

type ClienteCobranca = {
  nome: string;
  email?: string | null;
  documento?: string | null;
  telefone?: string | null;
};

function toAbacateCents(value: number) {
  return new Decimal(value || 0)
    .mul(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

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

async function resolveCliente(
  executor: PrismaExecutor,
  contaId: number,
  clienteId?: number,
): Promise<ClienteCobranca | null> {
  if (!clienteId) return null;

  const cliente = await executor.clientesFornecedores.findFirst({
    where: {
      id: clienteId,
      contaId,
    },
    select: {
      nome: true,
      email: true,
      documento: true,
      telefone: true,
    },
  });

  if (!cliente) {
    throw new Error("O cliente informado não foi encontrado para esta conta.");
  }

  return cliente;
}

async function resolveAbacatePayTenantConfig(contaId: number) {
  const parametros = await prisma.parametrosConta.findUnique({
    where: { contaId },
    select: {
      AbacatePayApiKey: true,
      AbacatePaySecret: true,
    },
  });

  if (!parametros?.AbacatePayApiKey) {
    throw new Error(
      "AbacatePay não configurado para esta conta. Informe a API Key em /configuracoes > Integrações.",
    );
  }

  if (!parametros?.AbacatePaySecret) {
    throw new Error(
      "AbacatePay sem secret configurado para esta conta. Informe o Webhook Secret em /configuracoes > Integrações.",
    );
  }

  return parametros as Pick<ParametrosConta, "AbacatePayApiKey" | "AbacatePaySecret">;
}

async function createChargeRecord(
  executor: PrismaExecutor,
  body: BodyCobranca,
  contaId: number,
  payload: {
    Uid: string;
    gatewayReference: string;
    paymentLink?: string | null;
    observacao: string;
  },
) {
  return executor.cobrancasFinanceiras.create({
    data: {
      dataVencimento: new Date(),
      gateway: "abacatepay",
      valor: body.value,
      dataCadastro: new Date(),
      Uid: payload.Uid,
      idCobranca: payload.gatewayReference,
      vendaId:
        body.vinculo && body.vinculo.tipo === "venda"
          ? body.vinculo.id
          : null,
      lancamentoId:
        body.vinculo && body.vinculo.tipo === "parcela"
          ? body.vinculo.id
          : null,
      ordemServicoId:
        body.vinculo && body.vinculo.tipo === "os" ? body.vinculo.id : null,
      reservaId:
        body.vinculo && body.vinculo.tipo === "reserva"
          ? body.vinculo.id
          : null,
      externalLink: payload.paymentLink || null,
      status: "PENDENTE",
      observacao: payload.observacao,
      contaId,
    },
  });
}

export async function generateCobrancaAbacatePay(
  body: BodyCobranca,
  contaId: number,
  executor: PrismaExecutor = prisma,
): Promise<GeneratedChargeResult> {
  await assertChargeCreationAllowed(contaId);
  const tenantConfig = await resolveAbacatePayTenantConfig(contaId);
  const abacate = new AbacatePayService(tenantConfig.AbacatePayApiKey!);
  const Uid = gerarIdUnicoComMetaFinal("COB");
  const externalIdBase = `conta:${contaId}|cobranca:${Uid}`;
  const cliente = await resolveCliente(executor, contaId, body.clienteId || undefined);

  if (body.type === "BOLETO" && !cliente) {
    throw new Error("Informe o cliente para gerar cobrança por boleto na AbacatePay.");
  }

  if (
    body.type === "BOLETO" &&
    !normalizeTaxId(cliente?.documento)
  ) {
    throw new Error(
      "O cliente precisa ter CPF ou CNPJ informado para gerar boleto na AbacatePay.",
    );
  }

  if (body.type === "LINK") {
    const product = await abacate.createProduct({
      externalId: `${externalIdBase}|produto`,
      name: `Cobrança Gestão Fácil ${Uid}`,
      description: "Cobrança avulsa gerada pelo sistema - Gestão Fácil - ERP",
      price: toAbacateCents(body.value),
      currency: "BRL",
    });

    const checkout = await abacate.createCheckout({
      items: [{ id: product.id, quantity: 1 }],
      methods: ["PIX", "CARD"],
      customerId:
        cliente?.email || cliente?.documento || cliente?.telefone
          ? (
              await abacate.createCustomer({
                email:
                  cliente?.email || `cliente-${contaId}-${Uid.toLowerCase()}@gestaofacil.local`,
                name: cliente?.nome,
                taxId: normalizeTaxId(cliente?.documento),
                cellphone: normalizeCellphone(cliente?.telefone),
                metadata: {
                  contaId,
                  cobrancaUid: Uid,
                  origem: "gestaofacil-financeiro",
                },
              })
            ).id
          : undefined,
      externalId: `${externalIdBase}|link`,
      metadata: {
        contaId,
        cobrancaUid: Uid,
        origem: "gestaofacil-financeiro",
      },
    });

    const cobranca = await createChargeRecord(executor, body, contaId, {
      Uid,
      gatewayReference: checkout.id,
      paymentLink: checkout.url,
      observacao: "Cobrança por link gerada via AbacatePay - Gestão Fácil - ERP",
    });

    return {
      paymentLink: checkout.url || null,
      chargeId: cobranca.id,
      gatewayReference: checkout.id,
    };
  }

  const charge = await abacate.createTransparentCharge({
    method: body.type === "BOLETO" ? "BOLETO" : "PIX",
    data: {
      amount: toAbacateCents(body.value),
      description: "Cobrança avulsa gerada pelo sistema - Gestão Fácil - ERP",
      externalId: `${externalIdBase}|${body.type.toLowerCase()}`,
      metadata: {
        contaId,
        cobrancaUid: Uid,
        origem: "gestaofacil-financeiro",
      },
      customer: cliente
        ? {
            name: cliente.nome,
            email: cliente.email || undefined,
            taxId: normalizeTaxId(cliente.documento),
            cellphone: normalizeCellphone(cliente.telefone),
          }
        : undefined,
    },
  });

  const paymentLink = charge.url || charge.brCode || charge.barCode || null;

  const cobranca = await createChargeRecord(executor, body, contaId, {
    Uid,
    gatewayReference: charge.id,
    paymentLink,
    observacao:
      body.type === "BOLETO"
        ? "Cobrança boleto gerada via AbacatePay - Gestão Fácil - ERP"
        : "Cobrança Pix gerada via AbacatePay - Gestão Fácil - ERP",
  });

  return {
    paymentLink,
    chargeId: cobranca.id,
    gatewayReference: charge.id,
  };
}
