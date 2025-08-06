import { Router } from "express";
import { renderFileSimple, renderSimple } from "../web";

const webRouterAdministracao = Router();

webRouterAdministracao.get("/usuarios/resumo", (req, res) => {
  renderSimple(req, res, "partials/administracao/index", {});
});
webRouterAdministracao.get("/usuarios/tabela", (req, res) => {
  renderFileSimple(req, res, "partials/administracao/tabela.html");
});

export {
  webRouterAdministracao
}