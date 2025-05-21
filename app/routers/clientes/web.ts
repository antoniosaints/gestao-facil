import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { renderFileAuth } from "../web";

const webClienteRouter = Router();

webClienteRouter.get("/resumo", authenticateJWT, (req, res) => {
  renderFileAuth(req, res, "partials/clientes_fornecedores/index.html");
});

export {
  webClienteRouter
}