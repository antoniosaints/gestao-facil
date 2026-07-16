import { NextFunction, Request, Response } from "express";
import { getCustomRequest } from "../helpers/getCustomRequest";
import { contaHasActiveModule } from "../services/contas/storeModulesService";

// Garante que a conta tem o app pago "core-ia" ativo antes de acessar qualquer feature de IA.
export const coreIaGate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const hasAccess = await contaHasActiveModule(contaId, "core-ia");
    if (!hasAccess) {
      return res.status(403).json({
        message: "O app CORE IA não está ativo no seu plano.",
      });
    }
    next();
  } catch (err) {
    return res.status(500).json({ message: "Erro ao validar acesso à IA." });
  }
};
