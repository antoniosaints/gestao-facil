import { Router } from "express";
import { renderFileSimple } from "../web";

const webRouterAdministracao = Router();

webRouterAdministracao.get("/usuarios/resumo", (req, res) => {
  renderFileSimple(req, res, "partials/administracao/index.html");
});
webRouterAdministracao.get("/usuarios/tabela", (req, res) => {
  renderFileSimple(req, res, "partials/administracao/tabela.html");
});

export {
  webRouterAdministracao
}