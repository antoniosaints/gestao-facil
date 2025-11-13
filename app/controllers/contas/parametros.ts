import { Request, Response } from "express";
import { handleError } from "../../utils/handleError";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";
import { updateParametrosContaSchema } from "../../schemas/contas";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { enqueuePushNotification } from "../../services/pushNotificationQueueService";

export const saveParametros = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const body = updateParametrosContaSchema.safeParse(req.body);

    if (!body.success) {
      return res.status(400).json({
        status: 400,
        message: body.error.issues[0].message,
        data: null,
      });
    }

    const parametros = await prisma.parametrosConta.upsert({
      where: {
        contaId: customData.contaId,
      },
      create: {
        contaId: customData.contaId,
        AsaasApiKey: body.data.AsaasApiKey,
        AsaasApiSecret: body.data.AsaasApiSecret,
        AsaasEnv: body.data.AsaasEnv,
        eventoEstoqueBaixo: body.data.eventoEstoqueBaixo,
        eventoSangria: body.data.eventoSangria,
        emailAvisos: body.data.emailAvisos,
        eventoVendaConcluida: body.data.eventoVendaConcluida,
        MercadoPagoApiKey: body.data.MercadoPagoApiKey,
        MercadoPagoEnv: body.data.MercadoPagoEnv,
      },
      update: {
        AsaasApiKey: body.data.AsaasApiKey,
        AsaasApiSecret: body.data.AsaasApiSecret,
        AsaasEnv: body.data.AsaasEnv,
        emailAvisos: body.data.emailAvisos,
        eventoEstoqueBaixo: body.data.eventoEstoqueBaixo,
        eventoSangria: body.data.eventoSangria,
        eventoVendaConcluida: body.data.eventoVendaConcluida,
        MercadoPagoApiKey: body.data.MercadoPagoApiKey,
        MercadoPagoEnv: body.data.MercadoPagoEnv,
      },
    });

    return ResponseHandler(res, "Parametros salvos com sucesso!", parametros);
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};

export const getParametros = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const parametros = await prisma.parametrosConta.findFirst({
      where: {
        contaId: customData.contaId,
      },
    });
    return ResponseHandler(res, "Parametros encontrados!", parametros);
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};
export const getDetalhePublico = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const id = req.query.id;
    if (!id || isNaN(Number(id)))
      res.status(400).json({
        status: 400,
        message: "Informe os dados necessários para o cadastro.",
        data: null,
      });

    const conta = await prisma.contas.findFirst({
      where: {
        id: Number(id),
      },
      select: {
        id: true,
        nome: true,
        profile: true,
        nomeFantasia: true,
        documento: true,
      },
    });
    if (!conta)
      res.status(400).json({
        status: 400,
        message: "Nenhuma conta foi encontrada.",
        data: null,
      });

    return ResponseHandler(res, "Detalhe público encontrado!", conta);
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};

export const savePublicoCliente = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const body = req.body;
    if (!body || !body.contaId) {
      return res.status(400).json({
        status: 400,
        message: "Informe os dados necessários para o cadastro.",
        data: null,
      });
    }
    if (!body.nome) {
      return res.status(400).json({
        status: 400,
        message: "O Campo nome é essencial.",
        data: null,
      });
    }
    const contaExists = await prisma.contas.findFirst({
      where: {
        id: Number(body.contaId),
      },
      include: {
        ParametrosConta: true,
      },
    });

    if (!contaExists) {
      return res.status(400).json({
        status: 400,
        message: "Não é possível se cadastrar nesse link.",
        data: null,
      });
    }

    if (contaExists.ParametrosConta) {
      const parametros = contaExists.ParametrosConta[0];
      if (!parametros.linkPublicoAtivo) {
        return res.status(400).json({
          status: 400,
          message:
            "O link publico está desativado, verifique com o administrador do sistema.",
          data: null,
        });
      }
      if (
        parametros.linkPublicoAtivo &&
        parametros.cadastrosPermitidosLinkPublico! <= 0
      ) {
        return res.status(400).json({
          status: 400,
          message: "Limite de cadastros atingido.",
          data: null,
        });
      }
    }

    const cliente = await prisma.clientesFornecedores.create({
      data: {
        Uid: gerarIdUnicoComMetaFinal("CLI"),
        status: "ATIVO",
        contaId: Number(body.contaId),
        nome: body.nome,
        email: body.email,
        telefone: body.telefone,
        whastapp: body.whastapp,
        cep: body.cep,
        estado: body.estado,
        cidade: body.cidade,
        endereco: body.endereco,
        observacaos: body.observacao,
      },
    });

    if (cliente) {
      if (
        contaExists.ParametrosConta &&
        contaExists.ParametrosConta[0].cadastrosPermitidosLinkPublico &&
        contaExists.ParametrosConta[0].cadastrosPermitidosLinkPublico > 0
      ) {
        await prisma.parametrosConta.update({
          where: {
            contaId: Number(body.contaId),
          },
          data: {
            cadastrosPermitidosLinkPublico: {
              decrement: 1,
            },
          },
        });
      }
    }

    await enqueuePushNotification(
      {
        body: `O cliente ${cliente.nome} se cadastrou via link público`,
        title: "Novo Cadastro via link",
      },
      Number(body.contaId),
      true
    );

    return ResponseHandler(res, "Seu cadastro foi realizado com sucesso!", {
      id: cliente.Uid,
      status: 200,
    });
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};

export const gerenciarLinkPublicoCliente = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    if (!req.body) {
      return res.status(400).json({
        status: 400,
        message: "Informe os dados necessários para o cadastro.",
        data: null,
      });
    }
    const parametros = await prisma.parametrosConta.upsert({
      where: {
        contaId: customData.contaId,
      },
      create: {
        contaId: customData.contaId,
        cadastrosPermitidosLinkPublico: Number(req.body.quantidade),
        linkPublicoAtivo: req.body.ativo,
      },
      update: {
        contaId: customData.contaId,
        cadastrosPermitidosLinkPublico: Number(req.body.quantidade),
        linkPublicoAtivo: req.body.ativo,
      },
    });

    return ResponseHandler(res, "Parametros salvos com sucesso!", parametros);
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};
