import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getCustomRequest } from "../helpers/getCustomRequest";
import { contaHasActiveModule } from "../services/contas/storeModulesService";
import { hasRestauranteCapability, type RestauranteCapability } from "../services/restaurante/access";

export function requireRestauranteModule(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const custom = getCustomRequest(req).customData;
    const active = await contaHasActiveModule(custom.contaId, "restaurante-delivery");
    if (!active) {
      res.status(403).json({
        error: {
          code: "restaurante_module_inactive",
          message: "O app Restaurante e Delivery precisa estar ativo.",
          requestId: req.headers["x-request-id"] || null,
        },
      });
      return;
    }
    next();
  };
}

export function requireRestauranteAccess(capability: RestauranteCapability): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const custom = getCustomRequest(req).customData;
    const [active, allowed] = await Promise.all([
      contaHasActiveModule(custom.contaId, "restaurante-delivery"),
      hasRestauranteCapability(custom, capability),
    ]);
    if (!active || !allowed) {
      res.status(403).json({
        error: {
          code: !active ? "restaurante_module_inactive" : "restaurante_forbidden",
          message: !active ? "O app Restaurante e Delivery precisa estar ativo." : "Voce nao possui permissao para esta acao.",
          requestId: req.headers["x-request-id"] || null,
        },
      });
      return;
    }
    next();
  };
}
