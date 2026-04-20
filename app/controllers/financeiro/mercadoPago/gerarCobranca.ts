import { randomUUID } from "crypto";
import { validarCpfCnpj } from "../../../helpers/formatters";
import { prisma } from "../../../utils/prisma";
import { gerarIdUnicoComMetaFinal } from "../../../helpers/generateUUID";
import { MercadoPagoService } from "../../../services/financeiro/mercadoPagoService";
import { BodyCobranca } from "../cobrancas";
import { ParametrosConta, Prisma } from "../../../../generated";
import { env } from "../../../utils/dotenv";
import { BodyCobrancaPublico } from "../../../schemas/arena/reservas";

type PrismaExecutor = Prisma.TransactionClient | typeof prisma;

export interface GeneratedChargeResult {
  paymentLink: string | null;
  chargeId: number | null;
  gatewayReference: string | null;
}

function validarRetornoPixMercadoPago(
  pixGenerated: Awaited<ReturnType<MercadoPagoService["payment"]["create"]>>
) {
  const paymentId = pixGenerated.id?.toString();
  const ticketUrl = pixGenerated.point_of_interaction?.transaction_data?.ticket_url;
  const qrCode = pixGenerated.point_of_interaction?.transaction_data?.qr_code;

  if (!paymentId) {
    throw new Error(
      "O Mercado Pago nao retornou o identificador da cobranca Pix."
    );
  }

  if (pixGenerated.status === "rejected" || pixGenerated.status === "cancelled") {
    throw new Error(
      "O Mercado Pago rejeitou a cobranca Pix. Verifique as configuracoes da conta antes de tentar novamente."
    );
  }

  if (!ticketUrl && !qrCode) {
    throw new Error(
      "O Mercado Pago nao retornou os dados do Pix. Nenhum QR Code ou link de pagamento foi gerado."
    );
  }

  return {
    paymentId,
    ticketUrl,
  };
}

async function criarRegistroCobranca(
  executor: PrismaExecutor,
  parametros: ParametrosConta,
  body: BodyCobranca,
  payload: {
    Uid: string;
    gatewayReference: string;
    externalLink?: string | null;
    dataVencimento?: Date | null;
    observacao?: string | null;
    status?: "PENDENTE" | "EFETIVADO" | "ESTORNADO" | "CANCELADO";
  }
) {
  return executor.cobrancasFinanceiras.create({
    data: {
      dataVencimento: payload.dataVencimento || new Date(),
      gateway: "mercadopago",
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
      externalLink: payload.externalLink || null,
      status: payload.status || "PENDENTE",
      observacao:
        payload.observacao ||
        "Cobrança gerada pelo sistema - Gestão Fácil - ERP",
      contaId: parametros.contaId,
    },
  });
}

export const gerarCobrancaMercadoPagoBoleto = async (
  mp: MercadoPagoService,
  body: BodyCobranca,
  parametros: ParametrosConta,
  executor: PrismaExecutor = prisma
): Promise<GeneratedChargeResult> => {
  if (body.value < 4)
    throw new Error(
      "O valor da cobranca quando em boleto deve ser maior ou igual a R$ 4,00"
    );
  if (!body.clienteId)
    throw new Error("O cliente deve ser informado para gerar o boleto.");

  const cliente = await executor.clientesFornecedores.findFirst({
    where: {
      id: body.clienteId,
      contaId: parametros.contaId,
    },
  });

  if (!cliente)
    throw new Error(
      "O cliente não existe na base, verifique se o mesmo foi cadastrado."
    );
  if (!cliente.cidade)
    throw new Error(
      "A cidade do cliente nao foi informada, atualize o cadastro do cliente."
    );
  if (cliente.nome.split(" ").length < 2)
    throw new Error("O Cliente precisa ter nome e sobrenome.");
  if (!cliente.endereco)
    throw new Error(
      "O endereço do cliente nao foi informado, atualize o cadastro do cliente."
    );
  if (!cliente.email)
    throw new Error(
      "O E-mail do cliente nao foi informado, atualize o cadastro do cliente."
    );
  if (!cliente.cep)
    throw new Error(
      "O CEP do cliente nao foi informado, atualize o cadastro do cliente."
    );
  if (!cliente.estado)
    throw new Error(
      "O estado do cliente nao foi informado, atualize o cadastro do cliente."
    );
  if (!cliente.documento)
    throw new Error(
      "O CPF/CNPJ do cliente nao foi informado, atualize o cadastro do cliente."
    );
  if (!validarCpfCnpj(cliente.documento))
    throw new Error(
      `O ${
        cliente.tipo === "CLIENTE" ? "CPF" : "CNPJ"
      } do cliente é inválido, verifique antes de continuar.`
    );

  const Uid = gerarIdUnicoComMetaFinal("COB");
  const boletoGenerated = await mp.payment.create({
    requestOptions: {
      idempotencyKey: String(parametros.contaId) + randomUUID(),
    },
    body: {
      transaction_amount: body.value,
      description: `Cobrança gerada pelo sistema - ${cliente.nome} - ERP`,
      payer: {
        email: cliente.email,
        first_name: cliente.nome.split(" ")[0],
        last_name: cliente.nome.split(" ")[1],
        entity_type: "individual",
        address: {
          city: cliente.cidade,
          federal_unit: cliente.estado,
          neighborhood: "Centro",
          street_name: cliente.endereco,
          street_number: "0",
          zip_code: cliente.cep,
        },
        type: "customer",
        identification: {
          type: cliente.tipo === "CLIENTE" ? "CPF" : "CNPJ",
          number: cliente.documento,
        },
      },
      external_reference: `conta:${parametros.contaId}|cobranca:${Uid}|boleto`,
      payment_method_id: "bolbradesco",
      installments: 1,
      callback_url: `${env.BASE_URL_FRONTEND}`,
      notification_url: `${env.BASE_URL}/mercadopago/webhook/cobrancas`,
    },
  });

  if (boletoGenerated.status === "rejected") {
    throw new Error(
      "A cobrança foi rejeitada pelo banco, verifique os dados do cliente."
    );
  }

  const cobranca = await criarRegistroCobranca(executor, parametros, body, {
    Uid,
    gatewayReference: boletoGenerated.id?.toString() || Uid,
    dataVencimento: boletoGenerated.date_of_expiration
      ? new Date(boletoGenerated.date_of_expiration)
      : new Date(),
    externalLink: boletoGenerated.transaction_details?.external_resource_url,
  });

  return {
    paymentLink: boletoGenerated.transaction_details?.external_resource_url || null,
    chargeId: cobranca.id,
    gatewayReference: boletoGenerated.id?.toString() || null,
  };
};

export const gerarCobrancaMercadoPagoPix = async (
  mp: MercadoPagoService,
  body: BodyCobranca,
  parametros: ParametrosConta,
  executor: PrismaExecutor = prisma
): Promise<GeneratedChargeResult> => {
  const Uid = gerarIdUnicoComMetaFinal("COB");
  const pixGenerated = await mp.payment.create({
    requestOptions: {
      idempotencyKey: String(parametros.contaId) + randomUUID(),
    },
    body: {
      payer: {
        email: parametros.emailAvisos || "admin@userp.com.br",
        entity_type: "individual",
      },
      external_reference: `conta:${parametros.contaId}|cobranca:${Uid}|pix`,
      transaction_amount: body.value,
      description: `Cobrança gerada pelo sistema - Gestão Fácil - ERP`,
      payment_method_id: "pix",
      installments: 1,
      callback_url: `${env.BASE_URL_FRONTEND}`,
      notification_url: `${env.BASE_URL}/mercadopago/webhook/cobrancas`,
    },
  });
  const pixData = validarRetornoPixMercadoPago(pixGenerated);

  const cobranca = await criarRegistroCobranca(executor, parametros, body, {
    Uid,
    gatewayReference: pixData.paymentId,
    dataVencimento: pixGenerated.date_of_expiration
      ? new Date(pixGenerated.date_of_expiration)
      : new Date(),
    externalLink: pixData.ticketUrl,
  });

  return {
    paymentLink: pixData.ticketUrl || null,
    chargeId: cobranca.id,
    gatewayReference: pixData.paymentId,
  };
};

export const gerarCobrancaMercadoPagoPixPublico = async (
  mp: MercadoPagoService,
  body: BodyCobrancaPublico,
  parametros: ParametrosConta,
  executor: PrismaExecutor = prisma
) => {
  const Uid = gerarIdUnicoComMetaFinal("COB");
  const pixGenerated = await mp.payment.create({
    requestOptions: {
      idempotencyKey: String(parametros.contaId) + randomUUID(),
    },
    body: {
      payer: {
        email: parametros.emailAvisos || "admin@userp.com.br",
        entity_type: "individual",
      },
      external_reference: `conta:${parametros.contaId}|cobranca:${Uid}|pix`,
      transaction_amount: body.value,
      description: `Cobrança gerada pelo sistema - Gestão Fácil - ERP`,
      payment_method_id: "pix",
      installments: 1,
      callback_url: `${env.BASE_URL_FRONTEND}`,
      notification_url: `${env.BASE_URL}/mercadopago/webhook/cobrancas`,
    },
  });
  const pixData = validarRetornoPixMercadoPago(pixGenerated);

  if (body.reservas && body.reservas.length > 0) {
    const cobranca = await executor.cobrancasFinanceiras.create({
      data: {
        dataVencimento: pixGenerated.date_of_expiration
          ? new Date(pixGenerated.date_of_expiration)
          : new Date(),
        gateway: "mercadopago",
        valor: body.value,
        Uid: Uid,
        dataCadastro: new Date(),
        idCobranca: pixData.paymentId,
        externalLink: pixData.ticketUrl,
        status: "PENDENTE",
        observacao: "Cobrança gerada pelo sistema - Gestão Fácil - ERP",
        contaId: parametros.contaId,
      },
    });

    const promises = body.reservas.map(async (reserva) => {
      return await executor.cobrancasOnAgendamentos.create({
        data: {
          cobrancaId: cobranca.id,
          agendamentoId: reserva,
        },
      });
    });

    await Promise.all(promises);

    return pixData.ticketUrl;
  }

  await executor.cobrancasFinanceiras.create({
    data: {
      dataVencimento: pixGenerated.date_of_expiration
        ? new Date(pixGenerated.date_of_expiration)
        : new Date(),
      gateway: "mercadopago",
      valor: body.value,
      Uid: Uid,
      dataCadastro: new Date(),
      idCobranca: pixData.paymentId,
      vendaId:
        body.vinculo && body.vinculo.tipo === "venda" ? body.vinculo.id : null,
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
      externalLink: pixData.ticketUrl,
      status: "PENDENTE",
      observacao: "Cobrança gerada pelo sistema - Gestão Fácil - ERP",
      contaId: parametros.contaId,
    },
  });

  return pixData.ticketUrl;
};

export const gerarCobrancaMercadoPagoLink = async (
  mp: MercadoPagoService,
  body: BodyCobranca,
  parametros: ParametrosConta,
  executor: PrismaExecutor = prisma
): Promise<GeneratedChargeResult> => {
  const Uid = gerarIdUnicoComMetaFinal("COB");
  const link = await mp.preference.create({
    requestOptions: {
      idempotencyKey: String(parametros.contaId) + randomUUID(),
    },
    body: {
      items: [
        {
          id: randomUUID(),
          title: `Cobrança gerada pelo sistema - Gestão Fácil - ERP`,
          quantity: 1,
          unit_price: body.value,
        },
      ],
      payer: {
        email: parametros.emailAvisos || "admin@userp.com.br",
      },
      back_urls: {
        success: `${env.BASE_URL_FRONTEND}/success?success=true`,
        failure: `${env.BASE_URL_FRONTEND}/success?success=false`,
        pending: `${env.BASE_URL_FRONTEND}/success?success=pending`,
      },
      notification_url: `${env.BASE_URL}/mercadopago/webhook/cobrancas`,
      external_reference: `conta:${parametros.contaId}|cobranca:${Uid}|link`,
      auto_return: "approved",
    },
  });

  const gatewayReference = String(link.id || Uid);
  const paymentLink = link.init_point || null;

  const cobranca = await criarRegistroCobranca(executor, parametros, body, {
    Uid,
    gatewayReference,
    externalLink: paymentLink,
    observacao:
      "Cobrança por link gerada pelo sistema - Gestão Fácil - ERP",
  });

  return {
    paymentLink,
    chargeId: cobranca.id,
    gatewayReference,
  };
};

export const generateCobrancaMercadoPago = async (
  body: BodyCobranca,
  parametros: ParametrosConta,
  executor: PrismaExecutor = prisma
): Promise<GeneratedChargeResult> => {
  if (!parametros.MercadoPagoApiKey)
    throw new Error(
      "API Key nao encontrada, adicione a chave do Mercado Pago."
    );

  const tipo = body.type;
  const mp = new MercadoPagoService(parametros.MercadoPagoApiKey);
  if (tipo === "LINK") {
    return gerarCobrancaMercadoPagoLink(mp, body, parametros, executor);
  }
  if (tipo === "PIX") {
    return gerarCobrancaMercadoPagoPix(mp, body, parametros, executor);
  }
  if (tipo === "BOLETO") {
    return await gerarCobrancaMercadoPagoBoleto(mp, body, parametros, executor);
  }

  throw new Error("Tipo de cobranca nao encontrado.");
};

export const generateCobrancaMercadoPagoPublico = async (
  body: BodyCobrancaPublico,
  parametros: ParametrosConta,
  executor: PrismaExecutor = prisma
) => {
  if (!parametros.MercadoPagoApiKey)
    throw new Error(
      "API Key nao encontrada, adicione a chave do Mercado Pago."
    );

  const tipo = body.type;
  const mp = new MercadoPagoService(parametros.MercadoPagoApiKey);
  if (tipo === "PIX") {
    return gerarCobrancaMercadoPagoPixPublico(mp, body, parametros, executor);
  }

  throw new Error("Tipo de cobranca nao encontrado.");
};
