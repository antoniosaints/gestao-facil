import type { CustomData } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";

export type OurivePapel = "GESTOR" | "ATENDIMENTO" | "OURIVE" | "REVISAO";

export const OURIVE_CAPABILITIES = ["VISUALIZAR", "RECEBER", "ORCAMENTO", "PRODUCAO", "REVISAO", "ENTREGAR", "EQUIPE", "RELATORIOS", "CONFIGURAR", "FINANCEIRO", "KANBAN", "PAGAMENTOS", "PROLABORE"] as const;
export type OuriveCapability = (typeof OURIVE_CAPABILITIES)[number];

const permissions: Record<OurivePapel, OuriveCapability[]> = {
  GESTOR: [...OURIVE_CAPABILITIES],
  ATENDIMENTO: ["VISUALIZAR", "RECEBER", "ORCAMENTO", "KANBAN"],
  OURIVE: ["VISUALIZAR", "PRODUCAO", "KANBAN"],
  REVISAO: ["VISUALIZAR", "REVISAO", "ENTREGAR"],
};

function isManager(user: { permissao: string; superAdmin: boolean }) {
  return user.superAdmin || user.permissao === "root" || user.permissao === "admin";
}

export async function getOuriveAccess(custom: CustomData) {
  const user = await prisma.usuarios.findFirstOrThrow({ where: { id: custom.userId, contaId: custom.contaId }, select: { id: true, permissao: true, superAdmin: true } });
  if (isManager(user)) return { papeis: ["GESTOR"] as OurivePapel[], capabilities: [...OURIVE_CAPABILITIES], usuarioId: user.id };
  const rows = await prisma.ouriveUsuarioPapel.findMany({ where: { contaId: custom.contaId, usuarioId: user.id }, select: { papel: true } });
  const papeis = rows.map((row) => row.papel);
  return { papeis, capabilities: [...new Set(papeis.flatMap((papel) => permissions[papel]))], usuarioId: user.id };
}

export async function hasOuriveCapability(custom: CustomData, capability: OuriveCapability) {
  return (await getOuriveAccess(custom)).capabilities.includes(capability);
}
