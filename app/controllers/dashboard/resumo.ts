import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";
import Decimal from "decimal.js";
import { formatCurrency } from "../../utils/formatters";
import { getLastMonth, getThisMonth, getThisWeek, getThisYear } from "./hooks";

export const resumoDashboard = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { contaId, userId } = getCustomRequest(req).customData;
  const { periodo } = req.query;

  let dataFilter = null;

  switch (periodo) {
    case "semana":
      dataFilter = {
        gte: getThisWeek().start,
        lte: getThisWeek().end,
      };
      break;
    case "mes":
      dataFilter = {
        gte: getThisMonth().start,
        lte: getThisMonth().end,
      };
      break;
    case "mespassado":
      dataFilter = {
        gte: getLastMonth().start,
        lte: getLastMonth().end,
      };
      break;
    case "ano":
      dataFilter = {
        gte: getThisYear().start,
        lte: getThisYear().end,
      };
      break;
    default:
      dataFilter = null;
      break;
  }

  try {
    const result = await prisma.$transaction(async (tsc) => {
      const vendasMesPassado = await tsc.vendas.findMany({
        where: {
          OR: [
            {
              contaId: contaId,
              status: {
                in: ["FATURADO", "FINALIZADO"],
              },
              data: {
                gte: getLastMonth().start,
                lte: getLastMonth().end,
              },
            },
          ],
        },
      });
      const vendasEsteMes = await tsc.vendas.findMany({
        where: {
          OR: [
            {
              contaId: contaId,
              status: {
                in: ["FATURADO", "FINALIZADO"],
              },
              data: {
                gte: getThisMonth().start,
                lte: getThisMonth().end,
              },
            },
          ],
        },
      });

      const vendas = await tsc.vendas.findMany({
        where: {
          OR: [
            {
              contaId: contaId,
              status: {
                in: ["FATURADO", "FINALIZADO"],
              },
              data: dataFilter
                ? dataFilter
                : {
                    gte: getThisWeek().start,
                    lte: getThisWeek().end,
                  },
            },
          ],
        },
      });

      const vendasTotalMesPassado = vendasMesPassado.reduce(
        (acc, cur) => acc.add(cur.valor),
        new Decimal(0)
      );
      const vendasTotal = vendasEsteMes.reduce(
        (acc, cur) => acc.add(cur.valor),
        new Decimal(0)
      );
      const percentageByLastMonth = vendasTotalMesPassado.gt(0)
        ? vendasTotal
            .minus(vendasTotalMesPassado)
            .div(vendasTotalMesPassado)
            .mul(100)
            .toNumber()
        : 0;

      const vendasCount =
        vendas && vendas.length > 0
          ? formatCurrency(
              vendas.reduce((acc, cur) => acc.add(cur.valor), new Decimal(0))
            )
          : "R$ 0,00";

      const produtos = await tsc.produto.findMany({
        select: {
          id: true,
          estoque: true,
          minimo: true,
          nome: true,
          preco: true,
        },
        where: {
          OR: [{ contaId: contaId }],
        },
      });

      const estoquesBaixos =
        produtos && produtos.length > 0
          ? produtos.filter((produto) => {
              return produto.estoque <= produto.minimo;
            })
          : [];

      const clientes = await tsc.clientesFornecedores.count({
        where: {
          OR: [{ contaId: contaId }],
        },
      });

      return {
        vendasCount,
        estoquesBaixos,
        clientes,
        produtos,
        percentageByLastMonth,
      };
    });

    return ResponseHandler(res, "Resumo", result);
  } catch (error) {
    handleError(res, error);
  }
};
