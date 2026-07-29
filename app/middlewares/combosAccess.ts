import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getCustomRequest } from "../helpers/getCustomRequest";
import { hasPermission } from "../helpers/userPermission";
import { contaHasActiveModule } from "../services/contas/storeModulesService";

export function requireCombosAccess(level = 1): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const custom = getCustomRequest(req).customData;
    const [active, allowed] = await Promise.all([
      contaHasActiveModule(custom.contaId, "combos"),
      hasPermission(custom, level),
    ]);
    if (!active || !allowed) {
      res.status(403).json({
        status: 403,
        message: !active ? "O app Combos precisa estar ativo." : "Você não possui permissão para esta ação.",
        data: null,
        error: { code: !active ? "combos_module_inactive" : "combos_forbidden" },
      });
      return;
    }
    next();
  };
}

