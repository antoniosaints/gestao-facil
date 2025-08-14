import { Router } from "express";
import { prisma } from "../../utils/prisma";
import Decimal from "decimal.js";
import { formatCurrency } from "../../utils/formatters";

const webRouterProdutos = Router();

webRouterProdutos.get("/resumo", async (req, res): Promise<any> => {
  const isHTMX = req.headers["hx-request"];
  res.render("partials/produtos/index", {
    layout: isHTMX ? false : "main",
  });
});
webRouterProdutos.get("/editar/formulario", (req, res) => {
  const isHTMX = req.headers["hx-request"];
  res.render("partials/produtos/formulario", {
    layout: isHTMX ? false : "main",
  });
});
webRouterProdutos.get("/detalhes/:id", async (req, res) => {
  const { id } = req.params;
  const produto = await prisma.produto.findUniqueOrThrow({
    where: { id: Number(id) },
  });
  const movimentacoes = await prisma.movimentacoesEstoque.findMany({
    where: { produtoId: produto.id },
  });

  let totalGasto = new Decimal(0);
  let totalVendido = new Decimal(0);
  let lucroLiquido = new Decimal(0);
  let totalEntradas = 0;
  let totalSaidas = 0;

  for (const mov of movimentacoes) {
    const quantidade = new Decimal(mov.quantidade);
    const custo = new Decimal(mov.custo);

    if (mov.tipo === "ENTRADA") {
      totalGasto = totalGasto.plus(quantidade.times(custo));
      totalEntradas += mov.quantidade;
    } else if (mov.tipo === "SAIDA") {
      totalVendido = totalVendido.plus(quantidade.times(custo));
      totalSaidas += mov.quantidade;
    }
  }

  lucroLiquido = totalVendido.minus(totalGasto || 0) || 0;

  const isHTMX = req.headers["hx-request"];
  res.render("partials/produtos/detalhes", {
    layout: isHTMX ? false : "main",
    produto,
    resumo: {
      totalGasto: formatCurrency(totalGasto),
      lucroLiquido: formatCurrency(lucroLiquido),
      totalEntradas,
      totalSaidas,
    },
  });
});

export { webRouterProdutos };
