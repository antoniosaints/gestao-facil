import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { renderFileAuth, renderFileSimple } from "../web";

const webRouterProdutos = Router();

webRouterProdutos.get("/resumo", authenticateJWT, (req, res) => {
  renderFileAuth(req, res, "partials/produtos/index.html");
});
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
  renderFileSimple(req, res, "partials/produtos/modais/gerar-relatorio-reposicao.html");
});
webRouterProdutos.get("/relatorio/geral", (req, res) => {
  renderFileSimple(req, res, "partials/produtos/modais/gerar-relatorio.html");
});
webRouterProdutos.get("/editar/formulario", (req, res) => {
  renderFileSimple(req, res, "partials/produtos/formulario.html");
});
webRouterProdutos.get("/detalhes", (req, res) => {
  renderFileSimple(req, res, "partials/produtos/detalhes.html");
});

export {
  webRouterProdutos
}