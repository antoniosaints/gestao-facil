import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getCustomRequest } from "../helpers/getCustomRequest";
import { contaHasActiveModule } from "../services/contas/storeModulesService";
import { hasOuriveCapability, type OuriveCapability } from "../services/ourive/access";

export function requireOuriveModule(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { contaId } = getCustomRequest(req).customData;
    if (!(await contaHasActiveModule(contaId, "ourives"))) return res.status(403).json({ error: { code: "ourive_module_inactive", message: "O app Ourive precisa estar ativo." } });
    next();
  };
}

export function requireOuriveAccess(capability: OuriveCapability): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const custom = getCustomRequest(req).customData;
    const [active, allowed] = await Promise.all([contaHasActiveModule(custom.contaId, "ourives"), hasOuriveCapability(custom, capability)]);
    if (!active || !allowed) return res.status(403).json({ error: { code: active ? "ourive_forbidden" : "ourive_module_inactive", message: active ? "Voce nao possui permissao para esta acao." : "O app Ourive precisa estar ativo." } });
    next();
  };
}
