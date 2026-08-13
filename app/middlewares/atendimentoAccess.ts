import type { NextFunction, Request, Response } from "express";
import { getCustomRequest } from "../helpers/getCustomRequest";
import { getAtendimentoAccess } from "../services/whatsapp/atendimentoAccess";

// O menu é uma preferência da conta, mas o Atendimento precisa aplicá-la no
// backend para que URLs e chamadas diretas não contornem a configuração.
export const atendimentoAccess = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const access = await getAtendimentoAccess(contaId);
    if (!access.enabled) {
      res.status(403).json({
        status: 403,
        message:
          access.reason === "app-inativo"
            ? "O app Atendimento não está ativo na sua mensalidade."
            : "O app Atendimento está oculto no menu desta conta.",
        data: null,
        error: { code: `atendimento_${access.reason}` },
      });
      return;
    }
    next();
  } catch {
    res.status(500).json({
      status: 500,
      message: "Erro ao validar o acesso ao Atendimento.",
      data: null,
      error: { code: "atendimento_access_validation_failed" },
    });
  }
};
