import { Request, Response, Router } from "express";
import { authenticateJWT } from "../middlewares/auth";
import { getCustomRequest } from "../helpers/getCustomRequest";
import { prisma } from "../utils/prisma";
import { webRouterProdutos } from "./produtos/web";
import { webRouterVendas } from "./vendas/web";
import { webRouterAdministracao } from "./administracao/web";
import { webClienteRouter } from "./clientes/web";

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

export const renderFileAuth = async (
  req: Request,
  res: Response,
  file: string
) => {
  if (await isAccountActive(req)) {
    res.sendFile(file, { root: "views" });
  } else {
    res.redirect("/plano/assinatura");
  }
};
export const renderAuth = async (
  req: Request,
  res: Response,
  file: string,
  data: any = {}
) => {
  if (await isAccountActive(req)) {
    res.render(file, data);
  } else {
    res.redirect("/plano/assinatura");
  }
};
export const renderFileSimple = async (
  req: Request,
  res: Response,
  file: string
) => {
  res.sendFile(file, { root: "views" });
};
export const renderSimple = async (
  req: Request,
  res: Response,
  file: string,
  data: any
) => {
  res.render(file, data);
};

webRouter.use("/produtos", webRouterProdutos);
webRouter.use("/vendas", webRouterVendas);
webRouter.use("/clientes", webClienteRouter);
webRouter.use("/administracao", webRouterAdministracao);

webRouter.get("/", (req, res): any => {
  res.render("home", {
    title: "Dashboard",
    layout: "main",
  });
});

webRouter.get("/login", (req, res) => {
  renderFileSimple(req, res, "partials/login.html");
});
webRouter.get("/resumos", authenticateJWT, async (req, res): Promise<any> => {
  const data = getCustomRequest(req).customData;
  const usuario = await prisma.usuarios.findUniqueOrThrow({
    where: {
      id: data.userId,
      contaId: data.contaId,
    },
  });
  renderAuth(req, res, "partials/dashboard", { usuario });
});

webRouter.get("/plano/assinatura", authenticateJWT, async (req, res) => {
  try {
    if ((await isAccountBloqueada(req)) || (await isAccountActive(req))) {
      renderFileSimple(req, res, "partials/assinatura/renovacao.html");
    } else {
      renderFileSimple(req, res, "partials/assinatura/index.html");
    }
  } catch (error) {
    console.log(error);
  }
});

export default webRouter;
