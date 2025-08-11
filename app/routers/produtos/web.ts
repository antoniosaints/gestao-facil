import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { renderFileAuth, renderFileSimple, renderSimple } from "../web";
import { prisma } from "../../utils/prisma";
import Decimal from "decimal.js";
import { formatCurrency } from "../../utils/formatters";
import { hasPermission } from "../../helpers/userPermission";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { ResponseHandler } from "../../utils/response";

const webRouterProdutos = Router();

webRouterProdutos.get(
  "/resumo",
  authenticateJWT,
  async (req, res): Promise<any> => {
    const customData = getCustomRequest(req).customData;
    if (!(await hasPermission(customData, 3))) {
      return ResponseHandler(
        res,
        "Nível de permissão insuficiente!",
        null,
        403
      );
    }
    return renderFileAuth(req, res, "partials/produtos/index.html");
  }
);
webRouterProdutos.get("/tabela", (req, res) => {
  renderFileSimple(req, res, "partials/produtos/tabela.html");
});
webRouterProdutos.get("/mobile/lista", (req, res) => {
  renderFileSimple(req, res, "partials/produtos/mobile.html");
});
webRouterProdutos.get("/reposicao/estoque", (req, res) => {
  renderFileSimple(req, res, "partials/produtos/modais/repor-estoque.html");
});
webRouterProdutos.get("/reposicao/relatorio", (req, res) => {
  renderFileSimple(
    req,
    res,
    "partials/produtos/modais/gerar-relatorio-reposicao.html"
  );
});
webRouterProdutos.get("/relatorio/geral", (req, res) => {
  renderFileSimple(req, res, "partials/produtos/modais/gerar-relatorio.html");
});
webRouterProdutos.get("/editar/formulario", (req, res) => {
  renderFileSimple(req, res, "partials/produtos/formulario.html");
});
webRouterProdutos.get("/detalhes/:id", authenticateJWT, async (req, res) => {
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

  renderSimple(req, res, "partials/produtos/detalhes", {
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
