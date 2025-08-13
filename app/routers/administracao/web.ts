import { Router } from "express";
import { renderAuth } from "../web";
import { authenticateJWT } from "../../middlewares/auth";

const webRouterAdministracao = Router();

webRouterAdministracao.get("/usuarios/resumo", authenticateJWT, (req, res) => {
  renderAuth(req, res, "partials/administracao/index");
});

export {
  webRouterAdministracao
}