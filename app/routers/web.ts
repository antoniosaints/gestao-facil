import { Request, Response, Router } from "express";
import { authenticateJWT } from "../middlewares/auth";
import { getCustomRequest } from "../helpers/getCustomRequest";
import { prisma } from "../utils/prisma";
import { createSubscription } from "../controllers/asaas/assinatura";

const webRouter = Router();

const isAccountBloqueada = async (req: Request) => {
  const customData = getCustomRequest(req).customData;
  const conta = await prisma.contas.findUniqueOrThrow({
    where: { id: customData.contaId },
  });
  return conta.status === "BLOQUEADO";
};
const isAccountActive = async (req: Request) => {
  const customData = getCustomRequest(req).customData;
  const conta = await prisma.contas.findUniqueOrThrow({
    where: { id: customData.contaId },
  });
  return conta.status === "ATIVO";
};

const renderFileAuth = async (req: Request, res: Response, file: string) => {
  if (await isAccountActive(req)) {
    res.sendFile(file, { root: "public" });
  }else {
    res.redirect("/plano/assinatura");
  }
};

webRouter.get("/", authenticateJWT, (req, res): any => {
  res.sendFile("index.html", { root: "public" });
});
webRouter.get("/resumos", authenticateJWT, (req, res): any => {
  renderFileAuth(req, res, "partials/dashboard.html");
});
webRouter.get("/produtos/resumo", authenticateJWT, (req, res) => {
  renderFileAuth(req, res, "partials/produtos/index.html");
});
webRouter.get("/vendas/resumo", authenticateJWT, (req, res) => {
  renderFileAuth(req, res, "partials/vendas/index.html");
});
webRouter.get("/clientes/resumo", authenticateJWT, (req, res) => {
  renderFileAuth(req, res, "partials/clientes_fornecedores/index.html");
});
webRouter.get("/login", (req, res) => {
  res.sendFile("partials/login.html", { root: "public" });
});

webRouter.get("/plano/assinatura", authenticateJWT, async (req, res) => {
  try {
    if (await isAccountBloqueada(req) || await isAccountActive(req)) {
      res.sendFile("partials/assinatura/renovacao.html", { root: "public" });
    } else {
      res.sendFile("partials/assinatura/index.html", { root: "public" });
    }
  } catch (error) {
    console.log(error);
  }
});

export default webRouter;
