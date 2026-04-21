import { env } from "../../utils/dotenv";
import { prisma } from "../../utils/prisma";

export type PlatformSaasGateway = "mercadopago" | "abacatepay";

export function normalizePlatformGateway(gateway?: string | null): PlatformSaasGateway {
  return gateway === "abacatepay" ? "abacatepay" : "mercadopago";
}

export async function getConfiguredPlatformGateway(): Promise<PlatformSaasGateway> {
  const config = await prisma.parametrosConta.findFirst({
    where: {
      gatewayRecebimentoSaas: {
        not: null,
      },
      Contas: {
        Usuarios: {
          some: {
            superAdmin: true,
          },
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      gatewayRecebimentoSaas: true,
    },
  });

  return normalizePlatformGateway(config?.gatewayRecebimentoSaas);
}

export async function applyPlatformGateway(contaId: number, gateway: PlatformSaasGateway) {
  const [, updateResult] = await prisma.$transaction([
    prisma.parametrosConta.upsert({
      where: {
        contaId,
      },
      create: {
        contaId,
        gatewayRecebimentoSaas: gateway,
      },
      update: {
        gatewayRecebimentoSaas: gateway,
      },
    }),
    prisma.contas.updateMany({
      data: {
        gateway: gateway as any,
      },
    }),
  ]);

  return {
    gateway,
    updatedAccounts: updateResult.count,
  };
}

export function getPlatformGatewayConfigStatus(gateway: PlatformSaasGateway) {
  return {
    gateway,
    mercadoPagoConfigured: Boolean(env.MP_ACCESS_TOKEN),
    abacatePayConfigured: Boolean(env.ABACATEPAY_API_KEY && env.ABACATEPAY_WEBHOOK_SECRET),
  };
}
