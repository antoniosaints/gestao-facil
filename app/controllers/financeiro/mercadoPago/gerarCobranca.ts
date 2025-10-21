import { randomUUID } from "crypto";
import { validarCpfCnpj } from "../../../helpers/formatters";
import { prisma } from "../../../utils/prisma";
import { gerarIdUnicoComMetaFinal } from "../../../helpers/generateUUID";
import { MercadoPagoService } from "../../../services/financeiro/mercadoPagoService";
import { BodyCobranca } from "../cobrancas";
import { ParametrosConta } from "../../../../generated";

export const gerarCobrancaMercadoPagoBoleto = async (
  mp: MercadoPagoService,
  body: BodyCobranca,
  parametros: ParametrosConta
) => {
  if (body.value < 4)
    throw new Error(
      "O valor da cobranca quando em boleto deve ser maior ou igual a R$ 4,00"
    );
  if (!body.clienteId)
    throw new Error("O cliente deve ser informado para gerar o boleto.");

  const cliente = await prisma.clientesFornecedores.findFirst({
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

  const link = await mp.payment.create({
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
      external_reference: `conta:${parametros.contaId}|cobranca|boleto`,
      payment_method_id: "bolbradesco",
      installments: 1,
      callback_url: `${process.env.BASE_URL}/mercadopago/webhook/cobrancas`,
      notification_url: `${process.env.BASE_URL}/mercadopago/webhook/cobrancas`,
    },
  });
  if (link.status === "rejected") {
    throw new Error(
      "A cobrança foi rejeitada pelo banco, verifique os dados do cliente."
    );
  }
  if (link) {
    await prisma.cobrancasFinanceiras.create({
      data: {
        dataVencimento: link.date_of_expiration
          ? new Date(link.date_of_expiration)
          : new Date(),
        gateway: "mercadopago",
        valor: body.value,
        dataCadastro: new Date(),
        Uid: gerarIdUnicoComMetaFinal("COB"),
        idCobranca: link.id?.toString(),
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
        externalLink: link.transaction_details?.external_resource_url,
        status: "PENDENTE",
        observacao: "Cobrança gerada pelo sistema - Gestão Fácil - ERP",
        contaId: parametros.contaId,
      },
    });
  }
  return link.transaction_details?.external_resource_url;
};

export const gerarCobrancaMercadoPagoPix = async (
  mp: MercadoPagoService,
  body: BodyCobranca,
  parametros: ParametrosConta
) => {
  const link = await mp.payment.create({
    requestOptions: {
      idempotencyKey: String(parametros.contaId) + randomUUID(),
    },
    body: {
      payer: {
        email: parametros.emailAvisos || "admin@userp.com.br",
        entity_type: "individual",
      },
      external_reference: `conta:${parametros.contaId}|cobranca|pix`,
      transaction_amount: body.value,
      description: `Cobrança gerada pelo sistema - Gestão Fácil - ERP`,
      payment_method_id: "pix",
      installments: 1,
      callback_url: `${process.env.BASE_URL}/mercadopago/webhook/cobrancas`,
      notification_url: `${process.env.BASE_URL}/mercadopago/webhook/cobrancas`,
    },
  });

  await prisma.cobrancasFinanceiras.create({
    data: {
      dataVencimento: link.date_of_expiration
        ? new Date(link.date_of_expiration)
        : new Date(),
      gateway: "mercadopago",
      valor: body.value,
      Uid: gerarIdUnicoComMetaFinal("COB"),
      dataCadastro: new Date(),
      idCobranca: link.id?.toString(),
      vendaId:
        body.vinculo && body.vinculo.tipo === "venda" ? body.vinculo.id : null,
      lancamentoId:
        body.vinculo && body.vinculo.tipo === "parcela"
          ? body.vinculo.id
          : null,
      ordemServicoId:
        body.vinculo && body.vinculo.tipo === "os" ? body.vinculo.id : null,
      externalLink: link.point_of_interaction?.transaction_data?.ticket_url,
      status: "PENDENTE",
      observacao: "Cobrança gerada pelo sistema - Gestão Fácil - ERP",
      contaId: parametros.contaId,
    },
  });

  return link.point_of_interaction?.transaction_data?.ticket_url;
};

export const gerarCobrancaMercadoPagoLink = async (
  mp: MercadoPagoService,
  body: BodyCobranca,
  parametros: ParametrosConta
) => {
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
        success: `${process.env.BASE_URL_FRONTEND}/success?success=true`,
        failure: `${process.env.BASE_URL_FRONTEND}/success?success=false`,
        pending: `${process.env.BASE_URL_FRONTEND}/success?success=pending`,
      },
      notification_url: `${process.env.BASE_URL}/mercadopago/webhook/cobrancas`,
      external_reference: `conta:${parametros.contaId}|cobranca|link`,
      auto_return: "approved",
    },
  });

  return link.init_point;
};

export const generateCobrancaMercadoPago = async (
  body: BodyCobranca,
  parametros: ParametrosConta
) => {
  if (!parametros.MercadoPagoApiKey)
    throw new Error(
      "API Key nao encontrada, adicione a chave do Mercado Pago."
    );

  const tipo = body.type;
  const mp = new MercadoPagoService(parametros.MercadoPagoApiKey);
  if (tipo === "LINK") {
    return gerarCobrancaMercadoPagoLink(mp, body, parametros);
  } else if (tipo === "PIX") {
    return gerarCobrancaMercadoPagoPix(mp, body, parametros);
  } else if (tipo === "BOLETO") {
    return await gerarCobrancaMercadoPagoBoleto(mp, body, parametros);
  } else {
    throw new Error("Tipo de cobranca nao encontrado.");
  }
};
