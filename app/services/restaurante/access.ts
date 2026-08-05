import type { RestaurantePapel } from "../../../generated";
import type { CustomData } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";

export const RESTAURANTE_CAPABILITIES = [
  "SALAO_VISUALIZAR",
  "SALAO_OPERAR",
  "SALAO_CONFIGURAR",
  "COMANDAS_OPERAR",
  "KDS_VISUALIZAR",
  "KDS_OPERAR",
  "KDS_CONFIGURAR",
  "IMPRESSAO_VISUALIZAR",
  "IMPRESSAO_CONFIGURAR",
  "CARDAPIO_VISUALIZAR",
  "CARDAPIO_CONFIGURAR",
  "PEDIDOS_VISUALIZAR",
  "PEDIDOS_OPERAR",
  "CONFIGURACOES_GERENCIAR",
  "PAPEIS_GERENCIAR",
] as const;

export type RestauranteCapability = (typeof RESTAURANTE_CAPABILITIES)[number];

const roles: Record<RestaurantePapel, RestauranteCapability[]> = {
  GESTOR: [...RESTAURANTE_CAPABILITIES],
  CAIXA: ["SALAO_VISUALIZAR", "SALAO_OPERAR", "COMANDAS_OPERAR", "IMPRESSAO_VISUALIZAR", "CARDAPIO_VISUALIZAR", "PEDIDOS_VISUALIZAR", "PEDIDOS_OPERAR"],
  GARCOM: ["SALAO_VISUALIZAR", "SALAO_OPERAR", "COMANDAS_OPERAR", "CARDAPIO_VISUALIZAR", "PEDIDOS_VISUALIZAR"],
  COZINHA: ["KDS_VISUALIZAR", "KDS_OPERAR", "IMPRESSAO_VISUALIZAR", "CARDAPIO_VISUALIZAR"],
  EXPEDICAO: ["IMPRESSAO_VISUALIZAR", "CARDAPIO_VISUALIZAR", "PEDIDOS_VISUALIZAR", "PEDIDOS_OPERAR"],
};

export function capabilitiesForRestaurantRoles(userRoles: RestaurantePapel[]) {
  return [...new Set(userRoles.flatMap((role) => roles[role]))];
}

const legacyMinimum: Record<RestauranteCapability, number> = {
  SALAO_VISUALIZAR: 1,
  SALAO_OPERAR: 2,
  SALAO_CONFIGURAR: 4,
  COMANDAS_OPERAR: 1,
  KDS_VISUALIZAR: 1,
  KDS_OPERAR: 2,
  KDS_CONFIGURAR: 4,
  IMPRESSAO_VISUALIZAR: 1,
  IMPRESSAO_CONFIGURAR: 4,
  CARDAPIO_VISUALIZAR: 1,
  CARDAPIO_CONFIGURAR: 4,
  PEDIDOS_VISUALIZAR: 1,
  PEDIDOS_OPERAR: 2,
  CONFIGURACOES_GERENCIAR: 4,
  PAPEIS_GERENCIAR: 4,
};

function permissionLevel(permission: string, superAdmin: boolean) {
  if (superAdmin) return 100;
  return { root: 5, admin: 4, gerente: 3, vendedor: 2, tecnico: 2, usuario: 1 }[permission] || 0;
}

export async function getRestauranteAccess(custom: CustomData) {
  const [user, configuredRoles] = await Promise.all([
    prisma.usuarios.findFirstOrThrow({
      where: { id: custom.userId, contaId: custom.contaId },
      select: { id: true, permissao: true, superAdmin: true },
    }),
    prisma.restauranteUsuarioPapel.findMany({
      where: { contaId: custom.contaId },
      select: { usuarioId: true, papel: true },
    }),
  ]);
  const level = permissionLevel(user.permissao, user.superAdmin);
  if (level >= 4) {
    return { papeis: ["GESTOR"] as RestaurantePapel[], capabilities: [...RESTAURANTE_CAPABILITIES], fallbackLegado: false };
  }
  if (!configuredRoles.length) {
    return {
      papeis: [] as RestaurantePapel[],
      capabilities: RESTAURANTE_CAPABILITIES.filter((capability) => level >= legacyMinimum[capability]),
      fallbackLegado: true,
    };
  }
  const userRoles = configuredRoles.filter((entry) => entry.usuarioId === user.id).map((entry) => entry.papel);
  return {
    papeis: userRoles,
    capabilities: capabilitiesForRestaurantRoles(userRoles),
    fallbackLegado: false,
  };
}

export async function hasRestauranteCapability(custom: CustomData, capability: RestauranteCapability) {
  const access = await getRestauranteAccess(custom);
  return access.capabilities.includes(capability);
}
