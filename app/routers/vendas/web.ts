import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { renderAuth } from "../web";

const webRouterVendas = Router();

webRouterVendas.get("/resumo", (req, res) => {
  const isHTMX = req.headers["hx-request"];
  res.render("partials/vendas/index", {
    layout: isHTMX ? false : "main",
  });
});
webRouterVendas.get("/formulario", async (req, res): Promise<any> => {
  const query = req.query;
  const isHTMX = req.headers["hx-request"];
  res.render("partials/vendas/cadastro", {
    layout: isHTMX ? false : "main",
    title: query.id ? "Editar venda" : "Nova venda",
    venda: { id: query.id ? Number(query.id) : null },
  });
});
webRouterVendas.get("/pdv", (req, res) => {
  const isHTMX = req.headers["hx-request"];
  res.render("partials/vendas/pdv", {
    layout: isHTMX ? false : "main",
  });
});
webRouterVendas.get("/detalhe", (req, res) => {
  const isHTMX = req.headers["hx-request"];
  res.render("partials/vendas/detalhes", {
    layout: isHTMX ? false : "main",
  });
});

export { webRouterVendas };
