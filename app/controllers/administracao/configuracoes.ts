import { Request, Response } from "express";

import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { env } from "../../utils/dotenv";
import { assertSuperAdmin } from "./assinantes";
import {
  applyPlatformGateway,
  getConfiguredPlatformGateway,
  getPlatformGatewayConfigStatus,
  type PlatformSaasGateway,
} from "../../services/contas/platformGatewayService";

function isValidGateway(value: unknown): value is PlatformSaasGateway {
  return value === "mercadopago" || value === "abacatepay";
}

export async function getAdminGatewayConfig(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const isSuperAdmin = await assertSuperAdmin(customData.userId);

    if (!isSuperAdmin) {
      return res.status(403).json({
        message: "Usuário não tem permissão para visualizar essas configurações.",
      });
    }

    const gateway = await getConfiguredPlatformGateway();

    return res.json({
      data: {
        ...getPlatformGatewayConfigStatus(gateway),
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function saveAdminGatewayConfig(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const isSuperAdmin = await assertSuperAdmin(customData.userId);

    if (!isSuperAdmin) {
      return res.status(403).json({
        message: "Usuário não tem permissão para alterar essas configurações.",
      });
    }

    const rawGateway = req.body?.gateway;
    if (!isValidGateway(rawGateway)) {
      return res.status(400).json({
        message: "Gateway inválido. Use mercadopago ou abacatepay.",
      });
    }

    const gateway = rawGateway;

    if (
      gateway === "abacatepay" &&
      (!env.ABACATEPAY_API_KEY || !env.ABACATEPAY_WEBHOOK_SECRET)
    ) {
      return res.status(400).json({
        message:
          "AbacatePay não configurado no ambiente. Defina ABACATEPAY_API_KEY e ABACATEPAY_WEBHOOK_SECRET antes de ativá-lo globalmente.",
      });
    }

    const result = await applyPlatformGateway(customData.contaId, gateway);

    return res.json({
      message: "Gateway padrão da mensalidade atualizado com sucesso.",
      data: {
        ...getPlatformGatewayConfigStatus(result.gateway),
        updatedAccounts: result.updatedAccounts,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
}
