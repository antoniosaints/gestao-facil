import { Router } from 'express';
import { authenticateJWT } from '../middlewares/auth';
import { getCustomRequest } from '../helpers/getCustomRequest';
import { prisma } from '../utils/prisma';

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
webRouter.get("/plano/assinatura", authenticateJWT, async (req, res) => {
  try {
    const customData = getCustomRequest(req).customData;
    const conta = await prisma.contas.findUniqueOrThrow({where: {id: customData.contaId}});

    if (conta.status !== "INATIVO") {
      res.sendFile("partials/assinatura/renovacao.html", { root: "public" });
    }else {
      res.sendFile("partials/assinatura/index.html", { root: "public" });
    }
  }catch (error) {
    console.log(error);
  }
});

export default webRouter;