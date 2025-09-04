import { Request, Response } from "express";
import { handleError } from "../../utils/handleError";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { getThisMonth } from "../dashboard/hooks";
import { Prisma } from "../../../generated";
import Decimal from "decimal.js";

export class ResumoVendasController {
  static async getResumo(req: Request, res: Response): Promise<any> {
    try {
      const customData = getCustomRequest(req).customData;
      const { inicio, fim } = req.query;

      const where: Prisma.VendasWhereInput = {
        contaId: customData.contaId,
      };

      if (inicio && fim) {
        where.data = {
          gte: new Date(inicio as string),
          lte: new Date(fim as string),
        };
      } else {
        where.data = {
          gte: getThisMonth().start,
          lte: getThisMonth().end,
        };
      }

      const vendas = await prisma.vendas.findMany({
        where,
        include: {
          PagamentoVendas: true,
        },
      });

      const totalVendas = vendas.length;
      const totalValorVendas = vendas.reduce((total, venda) => {
        return total.add(venda.valor.minus(venda.desconto || new Decimal(0)));
      }, new Decimal(0));

      const totalFaturado = vendas.filter((venda) => venda.status === "FATURADO").length;
      const totalValorFaturado = vendas.filter((venda) => venda.status === "FATURADO").reduce((total, venda) => {
        return total.add(venda.valor);
      }, new Decimal(0));

      const totalAberto = vendas.filter((venda) => ["PENDENTE", "FINALIZADO", "ORCAMENTO", "ANDAMENTO"].includes(venda.status)).length;
      const totalValorAberto = vendas.filter((venda) => ["PENDENTE", "FINALIZADO", "ORCAMENTO", "ANDAMENTO"].includes(venda.status)).reduce((total, venda) => {
        return total.add(venda.valor);
      }, new Decimal(0));

      const totalCancelado = vendas.filter((venda) => ["CANCELADO"].includes(venda.status)).length;
      const totalValorCancelado = vendas.filter((venda) => ["CANCELADO"].includes(venda.status)).reduce((total, venda) => {
        return total.add(venda.valor);
      }, new Decimal(0));

      const totalVendasComDesconto = vendas.filter((venda) => venda.desconto && venda.desconto.gt(0)).length;
      const totalValorDescontos = vendas.reduce((total, venda) => {
        return total.add(venda.desconto || new Decimal(0));
      }, new Decimal(0));

      const ticketMedio = totalValorVendas.div(totalVendas || new Decimal(1));

      return res.status(200).json({
        totalVendas,
        totalValorVendas: totalValorVendas.toFixed(2),
        totalFaturado,
        totalValorFaturado: totalValorFaturado.toFixed(2),
        totalAberto,
        totalValorAberto: totalValorAberto.toFixed(2),
        totalCancelado,
        totalValorCancelado: totalValorCancelado.toFixed(2),
        totalVendasComDesconto,
        totalValorDescontos: totalValorDescontos.toFixed(2),
        ticketMedio: ticketMedio.toFixed(2),
      });

    } catch (error) {
      handleError(res, error);
    }
  }
}
