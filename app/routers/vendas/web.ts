import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { renderAuth, renderFileAuth, renderFileSimple, renderSimple } from "../web";

const webRouterVendas = Router();

webRouterVendas.get("/resumo", authenticateJWT, (req, res) => {
  renderAuth(req, res, "partials/vendas/index");
});
webRouterVendas.get("/formulario", (req, res) => {
  renderSimple(req, res, "partials/vendas/cadastro", {});
});
webRouterVendas.get("/pdv", (req, res) => {
  renderSimple(req, res, "partials/vendas/pdv", {});
});
webRouterVendas.get("/detalhe", authenticateJWT, (req, res) => {
  renderAuth(req, res, "partials/vendas/detalhes");
});

export {
  webRouterVendas
}