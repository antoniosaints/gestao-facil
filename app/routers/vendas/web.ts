import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { renderFileAuth, renderFileSimple } from "../web";

const webRouterVendas = Router();

webRouterVendas.get("/resumo", authenticateJWT, (req, res) => {
  renderFileAuth(req, res, "partials/vendas/index.html");
});
webRouterVendas.get("/tabela", (req, res) => {
  renderFileSimple(req, res, "partials/vendas/tabela.html");
});
webRouterVendas.get("/formulario", (req, res) => {
  renderFileSimple(req, res, "partials/vendas/cadastro.html");
});
webRouterVendas.get("/pdv", (req, res) => {
  renderFileSimple(req, res, "partials/vendas/pdv.html");
});
webRouterVendas.get("/detalhe", authenticateJWT, (req, res) => {
  renderFileAuth(req, res, "partials/vendas/detalhes.html");
});
webRouterVendas.get("/filtro", (req, res) => {
  renderFileSimple(req, res, "partials/vendas/modais/filtro.html");
});


export {
  webRouterVendas
}