import { Request, Response } from "express";
import { ResponseHandler } from "../../utils/response";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { addDays } from "date-fns";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { updateContaSchema } from "../../schemas/contas";

export const criarConta = async (req: Request, res: Response): Promise<any> => {
  try {
    const {
      nome,
      email,
      senha,
      telefone,
      conta,
      tipo,
      funcionarios = 1,
      dicasNovidades,
      cpfCnpj,
    } = req.body;

    if (
      !nome ||
      !email ||
      !senha ||
      !telefone ||
      !conta ||
      !tipo ||
      !funcionarios
    ) {
      return res.status(400).json({
        status: 400,
        message: "Todos os campos obrigatórios devem ser preenchidos",
        data: null,
      });
    }

    const data = await prisma.$transaction(async (tx) => {
      const created = await tx.contas.create({
        data: {
          nome: conta,
          email,
          valor: 70,
          asaasCustomerId: "MERCADOPAGO",
          data: new Date(),
          funcionarios: Number(funcionarios),
          gateway: "mercadopago",
          vencimento: addDays(new Date(), 7),
          categoria: tipo,
          tipo: tipo,
          dicasNovidades,
          documento: cpfCnpj,
          status: "ATIVO",
          telefone,
        },
      });
      const user = await tx.usuarios.create({
        data: {
          nome,
          email,
          senha,
          emailReceiver: true,
          pushReceiver: true,
          permissao: "root",
          status: "ATIVO",
          contaId: created.id,
          telefone,
        },
      });

      return {
        created,
        user,
      };
    });

    ResponseHandler(res, "Conta criada com sucesso", data);
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};

export const atualizarDadosConta = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const body = updateContaSchema.safeParse(req.body);

    if (!body.success) {
      return res.status(400).json({
        status: 400,
        message: body.error.issues[0].message,
        data: null,
      });
    }

    const conta = await prisma.contas.update({
      where: {
        id: customData.contaId,
      },
      data: {
        nome: body.data.nome,
        telefone: body.data.telefone,
        documento: body.data.documento,
        dicasNovidades: body.data.dicasNovidades,
        nomeFantasia: body.data.nomeFantasia,
        endereco: body.data.endereco,
        cep: body.data.cep,
        tipo: body.data.tipo,
        emailAvisos: body.data.emailAvisos,
      },
    });
    return res.json(conta);
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};
export const dadosConta = async (req: Request, res: Response): Promise<any> => {
  try {
    const data = getCustomRequest(req).customData;
    const conta = await prisma.contas.findFirst({
      where: {
        id: data.contaId,
        Usuarios: {
          some: {
            id: data.userId,
          }
        },
      },
      include: {
        Usuarios: true,
      },
    });
    return res.json(conta);
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};
export const infosConta = async (req: Request, res: Response): Promise<any> => {
  try {
    const data = getCustomRequest(req).customData;
    const conta = await prisma.contas.findFirst({
      where: {
        id: data.contaId,
      },
    });
    return res.json(conta);
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};
