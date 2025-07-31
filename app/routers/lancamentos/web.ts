import { Router } from "express";
import { renderFileSimple } from "../web";

const webRouterLancamentos = Router();

webRouterLancamentos.get("/resumo", (req, res) => {
  renderFileSimple(req, res, "partials/lancamentos/index.html");
});
webRouterLancamentos.get("/web/dashboard", (req, res) => {
  renderFileSimple(req, res, "partials/lancamentos/dashboard/home.html");
});
webRouterLancamentos.get("/web/formulario", (req, res) => {
  renderFileSimple(req, res, "partials/lancamentos/formulario.html");
});
webRouterLancamentos.get("/tabela", (req, res) => {
  renderFileSimple(req, res, "partials/lancamentos/tabela.html");
});
webRouterLancamentos.get("/mobile/lista", (req, res) => {
  renderFileSimple(req, res, "partials/lancamentos/mobile.html");
});

export {
  webRouterLancamentos
}