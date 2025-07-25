import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";

export async function getLucroPorVenda(req: Request, res: Response): Promise<any> {
  try {
    const { inicio, fim } = req.query;
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
        totalVenda: number;
        totalCusto: number;
        lucro: number;
      }
    > = {};

    for (const item of itens) {
      const vendaId = item.vendaId;
      const precoCompra = Number(item.produto.precoCompra || 0);
      const valorVenda = Number(item.valor);
      const qtd = item.quantidade;

      const custo = precoCompra * qtd;
      const receita = valorVenda * qtd;
      const lucro = receita - custo;

      if (!lucroPorVenda[vendaId]) {
        lucroPorVenda[vendaId] = { totalVenda: 0, totalCusto: 0, lucro: 0 };
      }

      lucroPorVenda[vendaId].totalVenda += receita;
      lucroPorVenda[vendaId].totalCusto += custo;
      lucroPorVenda[vendaId].lucro += lucro;
    }

    return res.json({ periodo: { inicio, fim }, vendas: lucroPorVenda });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro interno no servidor." });
  }
}
