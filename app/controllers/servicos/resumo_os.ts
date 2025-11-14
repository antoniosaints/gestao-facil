import { Request, Response } from "express";
import { handleError } from "../../utils/handleError";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";
import { endOfMonth, format, startOfMonth } from "date-fns";
import Decimal from "decimal.js";
import { Prisma } from "../../../generated";

export const resumoOrdensServico = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;

    const ordensServico = await prisma.ordensServico.findMany({
      where: { contaId: customData.contaId },
      include: { ItensOrdensServico: true },
    });

    const resumo = {
      total: new Decimal(0),
      faturado: new Decimal(0),
      aberta: new Decimal(0),
      andamento: new Decimal(0),
      quantidade: 0,

      // quantidades por status
      qtdAberta: 0,
      qtdAndamento: 0,
      qtdFaturada: 0,
    };

    ordensServico.forEach((row) => {
      const totalOS = row.ItensOrdensServico.reduce((acc, item) => {
        return acc.plus(new Decimal(item.valor).times(item.quantidade));
      }, new Decimal(0));

      resumo.total = resumo.total.plus(totalOS);
      resumo.quantidade++;

      if (row.status === "ABERTA") {
        resumo.aberta = resumo.aberta.plus(totalOS);
        resumo.qtdAberta++;
      }

      if (row.status === "ANDAMENTO") {
        resumo.andamento = resumo.andamento.plus(totalOS);
        resumo.qtdAndamento++;
      }

      if (row.status === "FATURADA") {
        resumo.faturado = resumo.faturado.plus(totalOS);
        resumo.qtdFaturada++;
      }
    });

    return ResponseHandler(res, "Resumo encontrado", resumo);
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};

export const getEventosCalendario = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const { inicio, fim } = req.query;

    const where: Prisma.OrdensServicoWhereInput = {
      contaId: customData.contaId,
    };

    if (inicio && fim) {
      where.data = {
        gte: new Date(inicio as string),
        lte: new Date(fim as string),
      };
    } else {
      where.data = {
        gte: startOfMonth(new Date()),
        lte: endOfMonth(new Date()),
      };
    }
    const eventos = await prisma.ordensServico.findMany({
      where,
    });

    return ResponseHandler(res, "Eventos encontrados", eventos);
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};
