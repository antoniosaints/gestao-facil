import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getCustomRequest } from "../helpers/getCustomRequest";
import { contaHasActiveModule } from "../services/contas/storeModulesService";
import { prisma } from "../utils/prisma";

declare global {
  namespace Express {
    interface Request {
      restauranteEntregador?: { id: number; contaId: number; usuarioId: number; ativo: boolean };
    }
  }
}

/** Garante que o JWT pertence ao entregador ativo da mesma conta. */
export function requireRestauranteEntregador(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { contaId, userId } = getCustomRequest(req).customData;
    const [moduleActive, role, driver] = await Promise.all([
      contaHasActiveModule(contaId, "restaurante-delivery"),
      prisma.restauranteUsuarioPapel.findFirst({ where: { contaId, usuarioId: userId, papel: "ENTREGADOR" }, select: { usuarioId: true } }),
      prisma.restauranteEntregador.findFirst({ where: { contaId, usuarioId: userId, ativo: true }, select: { id: true, contaId: true, usuarioId: true, ativo: true } }),
    ]);

    if (!moduleActive || !role || !driver) {
      return res.status(403).json({
        error: {
          code: !moduleActive ? "restaurante_module_inactive" : "driver_forbidden",
          message: !moduleActive ? "O app Restaurante e Delivery precisa estar ativo." : "Este usuario nao esta habilitado como entregador.",
          requestId: req.headers["x-request-id"] || null,
        },
      });
    }
    req.restauranteEntregador = driver;
    next();
  };
}
