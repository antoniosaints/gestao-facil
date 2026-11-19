import type { Request, RequestHandler } from "express";
import { getCustomRequest } from "../helpers/getCustomRequest";

/** A autenticação vem antes deste middleware nas rotas privadas. */
export function createAppModuleAccess(
  code: string,
  name: string,
  active: (contaId: number, code: string) => Promise<boolean>,
  allowed?: (req: Request) => Promise<boolean>,
): RequestHandler {
  return async (req, res, next) => {
    const contaId = getCustomRequest(req).customData?.contaId;
    if (!Number.isSafeInteger(contaId) || contaId < 1) {
      res.status(401).json({ message: "Necessário efetuar login." });
      return;
    }
    try {
      if (allowed && !(await allowed(req))) {
        res.status(403).json({ message: "Você não possui permissão para acessar este recurso.", error: { code: "app_access_forbidden" } });
        return;
      }
      if (!(await active(contaId, code))) {
        res.status(403).json({
          message: `O app ${name} precisa estar ativo para acessar este recurso.`,
          error: { code: `${code.replace(/-/g, "_")}_module_inactive` },
        });
        return;
      }
      next();
    } catch {
      res.status(503).json({ message: "Não foi possível verificar o acesso ao app. Tente novamente.", error: { code: "app_access_unavailable" } });
    }
  };
}
