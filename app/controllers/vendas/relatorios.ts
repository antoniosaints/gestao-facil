import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import Decimal from "decimal.js";

export async function getLucroPorVendas(req: Request, res: Response): Promise<any> {
  try {
    const { inicio, fim, id } = req.query;
    const customData = getCustomRequest(req).customData;

    if (!inicio || !fim) {
      return res
        .status(400)
        .json({ erro: 'Parâmetros "inicio" e "fim" são obrigatórios.' });
    }

    const itens = await prisma.itensVendas.findMany({
      where: {
        venda: {
          contaId: customData.contaId,
          id: Number(id) || undefined,
          data: {
            gte: new Date(inicio as string),
            lte: new Date(fim as string),
          },
          status: { in: ["FATURADO", "FINALIZADO"] },
        },
      },
      select: {
        vendaId: true,
        quantidade: true,
        valor: true,
        produto: {
          select: { precoCompra: true },
        },
      },
    });

    const lucroPorVenda: Record<
      number,
      {
        totalVenda: Decimal;
        totalCusto: Decimal;
        lucro: Decimal;
      }
    > = {};

    let vendaTotal = new Decimal(0);
    let custoTotal = new Decimal(0);
    let lucroTotal = new Decimal(0);

    for (const item of itens) {
      const vendaId = item.vendaId;
      const precoCompra = new Decimal(item.produto.precoCompra || 0);
      const valorVenda = new Decimal(item.valor);
      const qtd = new Decimal(item.quantidade);

      const custo = precoCompra.mul(qtd);
      const receita = valorVenda.mul(qtd);
      const lucro = receita.minus(custo);

      if (!lucroPorVenda[vendaId]) {
        lucroPorVenda[vendaId] = {
          totalVenda: new Decimal(0),
          totalCusto: new Decimal(0),
          lucro: new Decimal(0),
        };
      }

      lucroPorVenda[vendaId].totalVenda = lucroPorVenda[vendaId].totalVenda.plus(receita);
      lucroPorVenda[vendaId].totalCusto = lucroPorVenda[vendaId].totalCusto.plus(custo);
      lucroPorVenda[vendaId].lucro = lucroPorVenda[vendaId].lucro.plus(lucro);

      vendaTotal = vendaTotal.plus(receita);
      custoTotal = custoTotal.plus(custo);
      lucroTotal = lucroTotal.plus(lucro);
    }

    return res.json({
      periodo: { inicio, fim },
      totais: {
        vendaTotal: vendaTotal.toNumber(),
        custoTotal: custoTotal.toNumber(),
        lucroTotal: lucroTotal.toNumber(),
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro interno no servidor." });
  }
}