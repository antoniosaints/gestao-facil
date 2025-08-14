import { Router } from "express";

const webRouterAdministracao = Router();

webRouterAdministracao.get("/usuarios/resumo", (req, res) => {
  const isHTMX = req.headers["hx-request"];
  res.render("partials/administracao/index", {
    layout: isHTMX ? false : "main",
  })
});

export {
  webRouterAdministracao
}