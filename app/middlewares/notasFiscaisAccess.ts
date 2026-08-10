import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getCustomRequest } from "../helpers/getCustomRequest";
import { hasPermission } from "../helpers/userPermission";
import { contaHasActiveModule } from "../services/contas/storeModulesService";

export function requireNotasFiscaisAccess(level: 3 | 4): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const custom = getCustomRequest(req).customData;
    const [active, allowed] = await Promise.all([
      contaHasActiveModule(custom.contaId, "notas-fiscais"),
      hasPermission(custom, level),
    ]);
    if (!active || !allowed) {
      res.status(403).json({
        error: {
          code: !active ? "notas_fiscais_module_inactive" : "notas_fiscais_forbidden",
          message: !active ? "O app Notas Fiscais precisa estar ativo." : "Você não possui permissão para esta ação.",
        },
      });
      return;
    }
    next();
  };
}
