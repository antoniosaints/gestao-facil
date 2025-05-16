import { Router } from 'express';
import { authenticateJWT } from '../middlewares/auth';

const webRouter = Router();

webRouter.get("/", authenticateJWT, (req, res): any => {
  res.sendFile("index.html", { root: "public" });
});
webRouter.get("/resumos", authenticateJWT, (req, res): any => {
  res.sendFile("partials/dashboard.html", { root: "public" });
});
webRouter.get("/produtos/resumo", authenticateJWT, (req, res) => {
  res.sendFile("partials/produtos/index.html", { root: "public" });
});
webRouter.get("/vendas/resumo", authenticateJWT, (req, res) => {
  res.sendFile("partials/vendas/index.html", { root: "public" });
});
webRouter.get("/clientes/resumo", authenticateJWT, (req, res) => {
  res.sendFile("partials/clientes_fornecedores/index.html", { root: "public" });
});
webRouter.get("/login", (req, res) => {
  res.sendFile("partials/login.html", { root: "public" });
});
webRouter.get("/assinatura/checkout", (req, res) => {
  res.sendFile("partials/assinatura/renovacao.html", { root: "public" });
});

export default webRouter;