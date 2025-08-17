import { Router } from "express";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";

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
  if (query.id) {
    const venda = await prisma.vendas.findUnique({
      where: { id: Number(query.id) },
    });
    if (venda?.status === "FATURADO") return ResponseHandler(res, "Venda já faturada!", null, 400);
  }
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
