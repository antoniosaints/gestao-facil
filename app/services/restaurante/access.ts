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
  // Entregador usa a PWA dedicada; nao recebe capacidades do backoffice.
  ENTREGADOR: [],
};

export function capabilitiesForRestaurantRoles(userRoles: RestaurantePapel[]) {
  return [...new Set(userRoles.flatMap((role) => roles[role]))];
}

function permissionLevel(permission: string, superAdmin: boolean) {
  if (superAdmin) return 100;
  return { root: 5, admin: 4, gerente: 3, vendedor: 2, tecnico: 2, usuario: 1 }[permission] || 0;
}

export function resolveRestaurantAccess(input: {
  user: { id: number; permissao: string; superAdmin: boolean };
  configuredRoles: Array<{ usuarioId: number; papel: RestaurantePapel }>;
}) {
  const level = permissionLevel(input.user.permissao, input.user.superAdmin);
  if (level >= 4) {
    return { papeis: ["GESTOR"] as RestaurantePapel[], capabilities: [...RESTAURANTE_CAPABILITIES], fallbackLegado: false };
  }
  const userRoles = input.configuredRoles
    .filter((entry) => entry.usuarioId === input.user.id)
    .map((entry) => entry.papel);
  return {
    papeis: userRoles,
    capabilities: capabilitiesForRestaurantRoles(userRoles),
    fallbackLegado: false,
  };
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
  return resolveRestaurantAccess({ user, configuredRoles });
}

export async function hasRestauranteCapability(custom: CustomData, capability: RestauranteCapability) {
  const access = await getRestauranteAccess(custom);
  return access.capabilities.includes(capability);
}
