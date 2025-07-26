import { Router } from "express";
import { renderFileSimple } from "../web";

const webRouterLancamentos = Router();

webRouterLancamentos.get("/resumo", (req, res) => {
  renderFileSimple(req, res, "partials/lancamentos/index.html");
});
webRouterLancamentos.get("/tabela", (req, res) => {
  renderFileSimple(req, res, "partials/lancamentos/tabela.html");
});

export {
  webRouterLancamentos
}