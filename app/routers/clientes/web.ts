import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { renderFileAuth, renderFileSimple, renderSimple } from "../web";

const webClienteRouter = Router();

webClienteRouter.get("/resumo", authenticateJWT, (req, res) => {
  renderFileAuth(req, res, "partials/clientes/index.html");
});
webClienteRouter.get("/tabela", (req, res) => {
  renderFileSimple(req, res, "partials/clientes/tabela.html");
});
webClienteRouter.get("/sheet/formulario", (req, res) => {
  renderFileSimple(req, res, "partials/clientes/sheet/cadastro.html");
});
webClienteRouter.get("/editar/formulario", (req, res) => {
  const id = req.query.id;

  renderSimple(req, res, "partials/clientes/modais/cadastro", {
    title: id == null || id == 'null' ? "Novo cliente" : "Editar cliente",
    id
  });
});
export {
  webClienteRouter
}