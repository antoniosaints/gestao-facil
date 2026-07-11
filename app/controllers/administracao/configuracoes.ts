import { Request, Response } from "express";
import { z } from "zod";

import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { env } from "../../utils/dotenv";
import { prisma } from "../../utils/prisma";
import { assertSuperAdmin } from "./assinantes";
import { getPlatformIndicacaoConfig } from "../../services/contas/indicacaoService";
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

export async function getAdminIndicacaoConfig(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    if (!(await assertSuperAdmin(customData.userId))) {
      return res.status(403).json({
        message: "Usuário não tem permissão para visualizar essas configurações.",
      });
    }

    const config = await getPlatformIndicacaoConfig();
    return res.json({
      data: {
        ativa: config.ativa,
        tipoRecompensa: config.tipoRecompensa,
        valorRecompensa: config.valorRecompensa.toNumber(),
        tipoBonusIndicado: config.tipoBonusIndicado,
        valorBonusIndicado: config.valorBonusIndicado.toNumber(),
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
}

const indicacaoConfigSchema = z.object({
  ativa: z.boolean(),
  tipoRecompensa: z.enum(["PERCENTUAL", "VALOR"]),
  valorRecompensa: z.coerce.number().min(0),
  tipoBonusIndicado: z.enum(["PERCENTUAL", "VALOR"]),
  valorBonusIndicado: z.coerce.number().min(0),
});

export async function saveAdminIndicacaoConfig(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    if (!(await assertSuperAdmin(customData.userId))) {
      return res.status(403).json({
        message: "Usuário não tem permissão para alterar essas configurações.",
      });
    }

    const parsed = indicacaoConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const data = parsed.data;

    // Config global vive na ParametrosConta da conta do superadmin (mesmo padrão do gateway).
    await prisma.parametrosConta.upsert({
      where: { contaId: customData.contaId },
      create: {
        contaId: customData.contaId,
        indicacaoAtiva: data.ativa,
        indicacaoTipoRecompensa: data.tipoRecompensa,
        indicacaoValorRecompensa: data.valorRecompensa,
        indicacaoTipoBonusIndicado: data.tipoBonusIndicado,
        indicacaoValorBonusIndicado: data.valorBonusIndicado,
      },
      update: {
        indicacaoAtiva: data.ativa,
        indicacaoTipoRecompensa: data.tipoRecompensa,
        indicacaoValorRecompensa: data.valorRecompensa,
        indicacaoTipoBonusIndicado: data.tipoBonusIndicado,
        indicacaoValorBonusIndicado: data.valorBonusIndicado,
      },
    });

    return res.json({
      message: "Programa de indicação atualizado com sucesso.",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
}
