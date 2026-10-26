import { Router } from "express";
import type { PrismaClient } from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { getConfiguracao, putConfiguracao } from "./service";

export function createConfiguracaoRouter(db: Pick<PrismaClient, "modoFacilConfiguracao">, notify: (contaId: number, result: unknown) => void) {
  const router = Router();
  router.get("/configuracao", async (req, res, next) => {
    try {
      const { contaId, permissao } = getCustomRequest(req).customData;
      res.json(await getConfiguracao(db, contaId, permissao));
    } catch (error) { next(error); }
  });
  router.put("/configuracao", async (req, res, next) => {
    try {
      const session = getCustomRequest(req).customData;
      const result = await putConfiguracao(db, session, req.body);
      // Persistence already succeeded; a socket failure is recoverable by GET.
      try { notify(session.contaId, result); } catch { console.warn("[modofacil] Configuração persistida; socket indisponível."); }
      res.json(result);
    } catch (error) { next(error); }
  });
  return router;
}
