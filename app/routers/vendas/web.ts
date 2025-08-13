import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { renderAuth } from "../web";

const webRouterVendas = Router();

webRouterVendas.get("/resumo", (req, res) => {
  const isHTMX = req.headers["hx-request"];
  // renderAuth(req, res, "partials/vendas/index");
  res.render("partials/vendas/index", {
    layout: isHTMX ? false : "main",
  });
});
webRouterVendas.get("/formulario", async (req, res): Promise<any> => {
  const isHTMX = req.headers["hx-request"];
  res.render("partials/vendas/cadastro", {
    layout: isHTMX ? false : "main",
    title: "Nova venda",
    venda: { id: null },
  });
});
webRouterVendas.get("/pdv", (req, res) => {
  const isHTMX = req.headers["hx-request"];
  res.render("partials/vendas/pdv", {
    layout: isHTMX ? false : "main",
  });
});
webRouterVendas.get("/detalhe", authenticateJWT, (req, res) => {
  renderAuth(req, res, "partials/vendas/detalhes");
});

export { webRouterVendas };
