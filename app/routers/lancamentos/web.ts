import { Router } from "express";
import { renderFileAuth, renderFileSimple } from "../web";
import { authenticateJWT } from "../../middlewares/auth";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { hasPermission } from "../../helpers/userPermission";
import { ResponseHandler } from "../../utils/response";

const webRouterLancamentos = Router();

webRouterLancamentos.get("/resumo", authenticateJWT, async (req, res): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  if (!(await hasPermission(customData, 4))) {
    return ResponseHandler(res, "Nível de permissão insuficiente!", null, 403);
  }
  renderFileAuth(req, res, "partials/lancamentos/index.html");
});
webRouterLancamentos.get("/web/dashboard", authenticateJWT, (req, res) => {
  renderFileAuth(req, res, "partials/lancamentos/dashboard/home.html");
});
webRouterLancamentos.get("/web/formulario", (req, res) => {
  renderFileSimple(req, res, "partials/lancamentos/modais/formulario.html");
});
webRouterLancamentos.get("/web/filtro", (req, res) => {
  renderFileSimple(req, res, "partials/lancamentos/modais/filtro.html");
});
webRouterLancamentos.get("/web/dre", (req, res) => {
  renderFileSimple(req, res, "partials/lancamentos/modais/dre.html");
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