import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import {
  renderAuth,
  renderSimple,
} from "../web";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";

const webRouterVendas = Router();

webRouterVendas.get("/resumo", authenticateJWT, (req, res) => {
  renderAuth(req, res, "partials/vendas/index");
});
webRouterVendas.get(
  "/formulario",
  authenticateJWT,
  async (req, res): Promise<any> => {
    const customData = getCustomRequest(req).customData;
    if (req.query.id) {
      const venda = await prisma.vendas.findUnique({
        where: {
          id: Number(req.query.id),
          contaId: customData.contaId,
        },
        include: {
          ItensVendas: true,
        },
      });

      if (!venda)
        return ResponseHandler(res, "Venda não encontrada", null, 404);

      return renderAuth(req, res, "partials/vendas/cadastro", {
        venda,
        title: "Editar venda",
      });
    }
    renderAuth(req, res, "partials/vendas/cadastro", {
      title: "Nova venda",
      venda: { id: null },
    });
  }
);
webRouterVendas.get("/pdv", (req, res) => {
  renderSimple(req, res, "partials/vendas/pdv", {});
});
webRouterVendas.get("/detalhe", authenticateJWT, (req, res) => {
  renderAuth(req, res, "partials/vendas/detalhes");
});

export { webRouterVendas };
