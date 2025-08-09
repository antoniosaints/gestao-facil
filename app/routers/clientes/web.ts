import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { renderAuth } from "../web";

const webClienteRouter = Router();

webClienteRouter.get("/resumo", authenticateJWT, (req, res) => {
  renderAuth(req, res, "partials/clientes/index");
});
export {
  webClienteRouter
}