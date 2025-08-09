import { Router } from "express";
import { renderAuth } from "../web";
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
  renderAuth(req, res, "partials/lancamentos/index");
});
webRouterLancamentos.get("/web/dashboard", authenticateJWT, (req, res) => {
  renderAuth(req, res, "partials/lancamentos/dashboard/home");
});
export {
  webRouterLancamentos
}