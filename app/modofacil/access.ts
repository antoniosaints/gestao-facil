import type { RequestHandler } from "express";
import type { PrismaClient } from "../../generated";
import { getCustomRequest } from "../helpers/getCustomRequest";
import { permissionLevels } from "./configuracao/service";
import { ModoFacilError } from "./errors";

// Current DB identity, never a permissive superAdmin/token-role shortcut. Support
// remains bound to the target identity and validated support session in JWT auth.
export function requireAccess(db: Pick<PrismaClient, "usuarios">, level = 1): RequestHandler {
  return async (req, _res, next) => {
    try {
      const session = getCustomRequest(req).customData;
      if (!session?.userId || !session?.contaId) throw new ModoFacilError(401, "unauthorized", "Sessão obrigatória.");
      const user = await db.usuarios.findFirst({
        where: { id: session.userId, contaId: session.contaId },
        select: { status: true, permissao: true, Contas: { select: { status: true } } },
      });
      if (!user || user.status !== "ATIVO" || user.Contas.status !== "ATIVO" || (permissionLevels[user.permissao] ?? 0) < level) {
        throw new ModoFacilError(403, "forbidden", "Você não tem permissão para esta operação.");
      }
      session.permissao = user.permissao;
      next();
    } catch (error) { next(error); }
  };
}
