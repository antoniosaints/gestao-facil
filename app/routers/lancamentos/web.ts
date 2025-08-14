import { Router } from "express";

const webRouterLancamentos = Router();

webRouterLancamentos.get("/resumo", async (req, res): Promise<any> => {
  const isHTMX = req.headers["hx-request"];
  res.render("partials/lancamentos/index", {
    layout: isHTMX ? false : "main",
  });
});
webRouterLancamentos.get("/dashboard", (req, res) => {
  const isHTMX = req.headers["hx-request"];
  res.render("partials/lancamentos/dashboard/home", {
    layout: isHTMX ? false : "main",
  });
});
export { webRouterLancamentos };
