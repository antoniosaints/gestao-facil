import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getCustomRequest } from "../helpers/getCustomRequest";
import { hasPermission } from "../helpers/userPermission";
import { contaHasActiveModule } from "../services/contas/storeModulesService";

export function requireRestauranteAccess(level = 1): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const custom = getCustomRequest(req).customData;
    const [active, allowed] = await Promise.all([
      contaHasActiveModule(custom.contaId, "restaurante-delivery"),
      hasPermission(custom, level),
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
