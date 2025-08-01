import { Request, Response } from "express";
import { ResponseHandler } from "../../utils/response";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { addDays } from "date-fns";

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
