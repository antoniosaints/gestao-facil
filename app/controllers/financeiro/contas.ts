import { Request, Response } from "express";
import { ResponseHandler } from "../../utils/response";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";


export const select2ContasFinanceiras = async (
  req: Request,
  res: Response
): Promise<any> => {
  const search = (req.query.search as string) || "";
  const { contaId } = getCustomRequest(req).customData;
  const contas = await prisma.contasFinanceiro.findMany({
    where: {
      contaId,
      nome: {
        contains: search,
      },
    },
    take: 10,
    orderBy: { nome: "asc" },
  });

  if (!contas) {
    return res.json({ results: [] });
  }

  const results = contas.map((row) => ({
    id: row.id,
    text: row.nome,
  }));

  res.json({ results });
};

export const saveContaFinanceiro = async (req: Request, res: Response): Promise<any> => {
    try {
        const { id, nome } = req.body;
        const { contaId } = getCustomRequest(req).customData;

        if (!nome) {
            return ResponseHandler(res, "Nome da conta obrigatorio!", null, 400);
        }

        if (id) {
            await prisma.contasFinanceiro.update({
                where: {
                    id: Number(id),
                    contaId
                },
                data: {
                    nome,
                },
            });
        } else {
            await prisma.contasFinanceiro.create({
                data: {
                    contaId,
                    nome,
                },
            });
        }

        return ResponseHandler(res, "Conta salva com sucesso!", null, 200);
    } catch (error) {
        handleError(res, error);
    }
}

export const deleteContaFinanceiro = async (req: Request, res: Response): Promise<any> => {
    try {
        const { id } = req.params;
        const { contaId } = getCustomRequest(req).customData;
        await prisma.contasFinanceiro.deleteMany({
            where: {
                id: Number(id),
                contaId,
            },
        });
        return ResponseHandler(res, "Conta deletada com sucesso!", null, 200);
    } catch (error) {
        handleError(res, error);
    }
}