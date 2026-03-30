import { randomUUID } from "node:crypto";
import { differenceInCalendarDays, format, isAfter, startOfDay } from "date-fns";
import Decimal from "decimal.js";
import { prisma } from "../../utils/prisma";
import {
  AsaasUpdateSubscription,
  createCharge,
  deleteCharge,
} from "../gateway/asaasService";
import { clearCacheAccount } from "../../controllers/administracao/contas";
import { MercadoPagoService } from "../financeiro/mercadoPagoService";
import { env } from "../../utils/dotenv";

const DEFAULT_MODULES = [
  {
    codigo: "core-ia",
    nome: "CORE IA",
    descricao: "Chat inteligente que auxilia na produtividade do time.",
    categoria: "Chat Inteligente",
    preco: 9.9,
  },
  {
    codigo: "whatsapp",
    nome: "WhatsApp",
    descricao: "Integracao com WhatsApp para comunicacao e notificacoes.",
    categoria: "Notificacoes",
    preco: 19.9,
  },
] as const;

const MODULE_CYCLE_DAYS = 30;

export type ModuleStatus =
  | "PENDENTE_ATIVACAO"
  | "ATIVO"
  | "CANCELAMENTO_AGENDADO"
  | "CANCELADO";

export type ModuleBillingMode = "PROPORCIONAL" | "MENSAL";

type ChargeGateway = "mercadopago" | "asaas";

function getToday() {
  return startOfDay(new Date());
}

function getChargeDescription(moduleName: string, billingMode: ModuleBillingMode) {
  return billingMode === "PROPORCIONAL"
    ? `Liberacao proporcional do app ${moduleName} ate o proximo vencimento`
    : `Primeira mensalidade do app ${moduleName}`;
}

function getChargeLink(cobranca: {
  externalLink?: string | null;
} | null) {
  return cobranca?.externalLink || null;
}

function toDecimal(value: Decimal.Value) {
  return new Decimal(value || 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function isContaSubscriptionActive(conta: {
  status?: string | null;
  vencimento: Date;
}) {
  return conta.status === "ATIVO" && differenceInCalendarDays(startOfDay(conta.vencimento), getToday()) >= 0;
}

export function calculateModuleImmediateCharge(
  modulePrice: Decimal.Value,
  dueDate: Date,
  billingMode: ModuleBillingMode,
) {
  const fullPrice = toDecimal(modulePrice);

  if (billingMode === "MENSAL") {
    return fullPrice;
  }

  const remainingDays = Math.max(
    differenceInCalendarDays(startOfDay(dueDate), getToday()),
    0,
  );

  if (remainingDays <= 0) {
    return fullPrice;
  }

  return Decimal.min(
    fullPrice,
    fullPrice.mul(remainingDays).div(MODULE_CYCLE_DAYS),
  ).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

async function getContaGatewayConfig(contaId: number) {
  const parametros = await prisma.parametrosConta.findUnique({
    where: {
      contaId,
    },
  });

  if (!parametros) {
    throw new Error(
      "Parametros da conta nao encontrados. Configure a integracao de pagamento antes de continuar.",
    );
  }

  return parametros;
}

async function createMercadoPagoModuleCharge(args: {
  contaId: number;
  email?: string | null;
  moduloOnContaId: number;
  amount: Decimal;
  description: string;
}) {
  const parametros = await getContaGatewayConfig(args.contaId);

  if (!parametros.MercadoPagoApiKey) {
    throw new Error("API Key do Mercado Pago nao encontrada.");
  }

  const mp = new MercadoPagoService(parametros.MercadoPagoApiKey);
  const payment = await mp.payment.create({
    requestOptions: {
      idempotencyKey: `${args.contaId}-${args.moduloOnContaId}-${randomUUID()}`,
    },
    body: {
      payer: {
        email: args.email || parametros.emailAvisos || "admin@userp.com.br",
        entity_type: "individual",
      },
      external_reference: `conta:${args.contaId}|modulo:${args.moduloOnContaId}|app`,
      transaction_amount: args.amount.toNumber(),
      description: args.description,
      payment_method_id: "pix",
      installments: 1,
      callback_url: `${env.BASE_URL_FRONTEND}/loja`,
      notification_url: `${env.BASE_URL}/mercadopago/webhook/cobrancas`,
    },
  });

  const paymentId = payment.id?.toString();
  const paymentLink =
    payment.point_of_interaction?.transaction_data?.ticket_url || null;

  if (!paymentId || !paymentLink) {
    throw new Error(
      "O Mercado Pago nao retornou os dados necessarios para gerar a cobranca do app.",
    );
  }

  return prisma.cobrancasFinanceiras.create({
    data: {
      contaId: args.contaId,
      gateway: "mercadopago",
      valor: args.amount.toNumber(),
      idCobranca: paymentId,
      externalLink: paymentLink,
      dataVencimento: payment.date_of_expiration
        ? new Date(payment.date_of_expiration)
        : new Date(),
      observacao: args.description,
      status: "PENDENTE",
    },
  });
}

async function createAsaasModuleCharge(args: {
  contaId: number;
  customerId: string;
  moduloOnContaId: number;
  amount: Decimal;
  dueDate: Date;
  description: string;
}) {
  const created = await createCharge({
    customer: args.customerId,
    billingType: "PIX",
    value: args.amount.toNumber(),
    dueDate: format(args.dueDate, "yyyy-MM-dd"),
    description: args.description,
    externalReference: `conta:${args.contaId}|modulo:${args.moduloOnContaId}|app`,
    callback: {
      autoRedirect: false,
      successUrl: `${env.BASE_URL_FRONTEND}/loja`,
    },
  });

  return prisma.cobrancasFinanceiras.create({
    data: {
      contaId: args.contaId,
      gateway: "asaas",
      valor: args.amount.toNumber(),
      idCobranca: created.id,
      externalLink:
        created.invoiceUrl || created.pixQrCodeUrl || created.bankSlipUrl || null,
      dataVencimento: args.dueDate,
      observacao: args.description,
      status: "PENDENTE",
    },
  });
}

async function cancelGatewayCharge(cobranca: {
  contaId: number;
  id: number;
  idCobranca: string;
  gateway: string;
  status: string;
}) {
  if (cobranca.status !== "PENDENTE") {
    return;
  }

  if (cobranca.gateway === "mercadopago") {
    const parametros = await getContaGatewayConfig(cobranca.contaId);

    if (!parametros.MercadoPagoApiKey) {
      throw new Error("API Key do Mercado Pago nao encontrada.");
    }

    const mp = new MercadoPagoService(parametros.MercadoPagoApiKey);
    await mp.payment.cancel({
      id: Number(cobranca.idCobranca),
    });
  }

  if (cobranca.gateway === "asaas") {
    await deleteCharge(cobranca.idCobranca);
  }

  await prisma.cobrancasFinanceiras.update({
    where: {
      id: cobranca.id,
    },
    data: {
      status: "CANCELADO",
    },
  });
}

async function clearModuleChargeState(moduleIds: number[]) {
  if (!moduleIds.length) return;

  await prisma.moduloOnConta.updateMany({
    where: {
      id: {
        in: moduleIds,
      },
    },
    data: {
      cobrancaAtualId: null,
      tipoCobrancaAtual: null,
      valorCobrancaAtual: null,
    },
  });
}

export async function cancelOutstandingModuleCharges(
  moduleIds: number[],
  cancelGateway = false,
) {
  if (!moduleIds.length) return;

  const modules = await prisma.moduloOnConta.findMany({
    where: {
      id: {
        in: moduleIds,
      },
      NOT: {
        cobrancaAtualId: null,
      },
    },
    include: {
      CobrancaAtual: true,
    },
  });

  if (cancelGateway) {
    for (const module of modules) {
      if (module.CobrancaAtual) {
        await cancelGatewayCharge({
          contaId: module.contaId,
          id: module.CobrancaAtual.id,
          idCobranca: module.CobrancaAtual.idCobranca,
          gateway: module.CobrancaAtual.gateway,
          status: module.CobrancaAtual.status,
        });
      }
    }
  }

  await clearModuleChargeState(modules.map((module) => module.id));
}

export async function ensureDefaultStoreModules() {
  await Promise.all(
    DEFAULT_MODULES.map((modulo) =>
      prisma.modulosAdicionais.upsert({
        where: {
          codigo: modulo.codigo,
        },
        create: {
          ...modulo,
        },
        update: {
          nome: modulo.nome,
          descricao: modulo.descricao,
          categoria: modulo.categoria,
          preco: modulo.preco,
          status: true,
        },
      }),
    ),
  );
}

export async function getContaNextRecurringValue(contaId: number) {
  const conta = await prisma.contas.findUniqueOrThrow({
    where: {
      id: contaId,
    },
    select: {
      valorBasePlano: true,
    },
  });

  const modulos = await prisma.moduloOnConta.findMany({
    where: {
      contaId,
      status: {
        in: ["ATIVO", "PENDENTE_ATIVACAO"] as any,
      },
      Modulos: {
        status: true,
      },
    },
    select: {
      valorAdicional: true,
    },
  });

  return modulos.reduce(
    (total, modulo) => total.plus(modulo.valorAdicional || 0),
    new Decimal(conta.valorBasePlano || 0),
  );
}

export async function contaHasActiveModule(contaId: number, codigo: string) {
  await ensureDefaultStoreModules();

  const moduleLink = await prisma.moduloOnConta.findFirst({
    where: {
      contaId,
      Modulos: {
        codigo,
      },
    },
    select: {
      status: true,
      vencimento: true,
    },
  });

  if (!moduleLink) return false;

  return (
    moduleLink.status === "ATIVO" ||
    (moduleLink.status === "CANCELAMENTO_AGENDADO" &&
      isAfter(moduleLink.vencimento, new Date()))
  );
}

export async function syncContaRecurringBilling(contaId: number) {
  const conta = await prisma.contas.findUniqueOrThrow({
    where: {
      id: contaId,
    },
    select: {
      id: true,
      nome: true,
      valorBasePlano: true,
      valor: true,
      email: true,
      documento: true,
      vencimento: true,
      asaasSubscriptionId: true,
      asaasCustomerId: true,
    },
  });

  const recurringValue = await getContaNextRecurringValue(contaId);

  await prisma.contas.update({
    where: {
      id: contaId,
    },
    data: {
      valor: recurringValue.toFixed(2),
    },
  });

  await prisma.faturasContas.updateMany({
    where: {
      contaId,
      status: {
        in: ["PENDENTE", "ATRASADO"],
      },
      vencimento: {
        gte: startOfDay(new Date()),
      },
    },
    data: {
      valor: recurringValue.toNumber(),
    },
  });

  if (conta.asaasSubscriptionId) {
    await AsaasUpdateSubscription(conta.asaasSubscriptionId, {
      customer: conta.asaasCustomerId,
      billingType: "UNDEFINED",
      nextDueDate: format(conta.vencimento, "yyyy-MM-dd"),
      value: recurringValue.toNumber(),
      cycle: "MONTHLY",
      description: `Assinatura do plano ${conta.nome} no Gestao Facil`,
      externalReference: `conta-gestaofacil-${conta.id}`,
      updatePendingPayments: true,
    });
  }

  await clearCacheAccount(contaId);

  return recurringValue;
}

export async function createImmediateModuleCharge(args: {
  contaId: number;
  moduloOnContaId: number;
  moduloNome: string;
  billingMode: ModuleBillingMode;
}) {
  const [conta, modulo] = await Promise.all([
    prisma.contas.findUniqueOrThrow({
      where: {
        id: args.contaId,
      },
      select: {
        id: true,
        email: true,
        gateway: true,
        status: true,
        vencimento: true,
        asaasCustomerId: true,
      },
    }),
    prisma.moduloOnConta.findUniqueOrThrow({
      where: {
        id: args.moduloOnContaId,
      },
      select: {
        id: true,
        valorAdicional: true,
      },
    }),
  ]);

  const amount = calculateModuleImmediateCharge(
    modulo.valorAdicional,
    conta.vencimento,
    args.billingMode,
  );

  const description = getChargeDescription(args.moduloNome, args.billingMode);

  const createdCharge =
    conta.gateway === "asaass" && conta.asaasCustomerId && conta.asaasCustomerId !== "MERCADOPAGO"
      ? await createAsaasModuleCharge({
          contaId: conta.id,
          customerId: conta.asaasCustomerId,
          moduloOnContaId: args.moduloOnContaId,
          amount,
          dueDate: conta.vencimento,
          description,
        })
      : await createMercadoPagoModuleCharge({
          contaId: conta.id,
          email: conta.email,
          moduloOnContaId: args.moduloOnContaId,
          amount,
          description,
        });

  await prisma.moduloOnConta.update({
    where: {
      id: args.moduloOnContaId,
    },
    data: {
      cobrancaAtualId: createdCharge.id,
      tipoCobrancaAtual: args.billingMode,
      valorCobrancaAtual: amount.toNumber(),
    },
  });

  return {
    chargeId: createdCharge.id,
    amount,
    paymentLink: getChargeLink(createdCharge),
  };
}

export async function cancelModuleCurrentCharge(moduleId: number) {
  const module = await prisma.moduloOnConta.findUnique({
    where: {
      id: moduleId,
    },
    include: {
      CobrancaAtual: true,
    },
  });

  if (!module?.CobrancaAtual) {
    await clearModuleChargeState([moduleId]);
    return;
  }

  await cancelGatewayCharge({
    contaId: module.contaId,
    id: module.CobrancaAtual.id,
    idCobranca: module.CobrancaAtual.idCobranca,
    gateway: module.CobrancaAtual.gateway,
    status: module.CobrancaAtual.status,
  });

  await clearModuleChargeState([moduleId]);
}

export async function activateStoreModuleFromCharge(chargeRecordId: number) {
  const module = await prisma.moduloOnConta.findFirst({
    where: {
      cobrancaAtualId: chargeRecordId,
    },
    include: {
      Contas: {
        select: {
          vencimento: true,
        },
      },
    },
  });

  if (!module) {
    return false;
  }

  await prisma.moduloOnConta.update({
    where: {
      id: module.id,
    },
    data: {
      status: "ATIVO",
      ativoDesde: new Date(),
      vencimento: module.Contas.vencimento,
      solicitadoCancelamentoEm: null,
      canceladoEm: null,
      cobrancaAtualId: null,
      tipoCobrancaAtual: null,
      valorCobrancaAtual: null,
    },
  });

  return true;
}

export async function releaseStoreModuleCharge(chargeRecordId: number) {
  const module = await prisma.moduloOnConta.findFirst({
    where: {
      cobrancaAtualId: chargeRecordId,
    },
    select: {
      id: true,
    },
  });

  if (!module) {
    return false;
  }

  await clearModuleChargeState([module.id]);

  return true;
}

export async function reconcileStoreModulesAfterPayment(
  contaId: number,
  previousDueDate: Date,
  nextDueDate: Date,
) {
  const modules = await prisma.moduloOnConta.findMany({
    where: {
      contaId,
    },
    select: {
      id: true,
      status: true,
      vencimento: true,
    },
  });

  const idsToCancel = modules
    .filter(
      (module) =>
        module.status === "CANCELAMENTO_AGENDADO" &&
        !isAfter(module.vencimento, previousDueDate),
    )
    .map((module) => module.id);

  const idsToActivate = modules
    .filter(
      (module) =>
        (module.status as string) === "PENDENTE_ATIVACAO" &&
        !isAfter(module.vencimento, previousDueDate),
    )
    .map((module) => module.id);

  const idsToExtend = modules
    .filter((module) => module.status === "ATIVO")
    .map((module) => module.id);

  await cancelOutstandingModuleCharges(idsToActivate, true);

  if (idsToCancel.length) {
    await prisma.moduloOnConta.updateMany({
      where: {
        id: {
          in: idsToCancel,
        },
      },
      data: {
        status: "CANCELADO",
        canceladoEm: new Date(),
      },
    });
  }

  if (idsToActivate.length) {
    await prisma.moduloOnConta.updateMany({
      where: {
        id: {
          in: idsToActivate,
        },
      },
      data: {
        status: "ATIVO",
        ativoDesde: new Date(),
        solicitadoCancelamentoEm: null,
        canceladoEm: null,
        vencimento: nextDueDate,
      },
    });
  }

  if (idsToExtend.length) {
    await prisma.moduloOnConta.updateMany({
      where: {
        id: {
          in: idsToExtend,
        },
      },
      data: {
        vencimento: nextDueDate,
      },
    });
  }

  await syncContaRecurringBilling(contaId);
}
