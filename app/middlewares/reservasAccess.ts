import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getCustomRequest } from "../helpers/getCustomRequest";
import { hasPermission } from "../helpers/userPermission";
import { contaHasActiveModule } from "../services/contas/storeModulesService";

export type ReservationPermission =
  | "reservas:visualizar"
  | "reservas:criar"
  | "reservas:editar"
  | "reservas:cancelar"
  | "reservas:estornar"
  | "reservas:configurar"
  | "reservas:financeiro";

const LEVELS: Record<ReservationPermission, number> = {
  "reservas:visualizar": 1,
  "reservas:criar": 2,
  "reservas:editar": 2,
  "reservas:cancelar": 3,
  "reservas:financeiro": 3,
  "reservas:estornar": 4,
  "reservas:configurar": 4,
};

export function requireReservationPermission(permission: ReservationPermission): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const customData = getCustomRequest(req).customData;
    const [active, allowed] = await Promise.all([
      contaHasActiveModule(customData.contaId, "reservas"),
      hasPermission(customData, LEVELS[permission]),
    ]);
    if (!active) {
      res.status(403).json({
        status: 403,
        message: "O módulo Reservas precisa estar ativo.",
        data: null,
      });
      return;
    }
    if (!allowed) {
      res.status(403).json({
        status: 403,
        message: "Você não possui permissão para esta ação.",
        data: null,
      });
      return;
    }
    next();
  };
}
