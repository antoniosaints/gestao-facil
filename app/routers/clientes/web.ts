import { Router } from "express";

const webClienteRouter = Router();

webClienteRouter.get("/resumo", (req, res) => {
  const isHTMX = req.headers["hx-request"];
  res.render("partials/clientes/index", {
    layout: isHTMX ? false : "main",
  })
});
export {
  webClienteRouter
}