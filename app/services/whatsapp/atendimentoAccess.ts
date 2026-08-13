import { prisma } from "../../utils/prisma";
import { contaHasActiveModule } from "../contas/storeModulesService";
import { AtendimentoAccess, resolveAtendimentoAccess } from "./atendimentoAccessPolicy";

export type { AtendimentoAccess, AtendimentoAccessReason } from "./atendimentoAccessPolicy";

export async function getAtendimentoAccess(contaId: number): Promise<AtendimentoAccess> {
  const [moduleActive, parametros] = await Promise.all([
    contaHasActiveModule(contaId, "atendimento"),
    prisma.parametrosConta.findUnique({ where: { contaId }, select: { menusVisiveis: true } }),
  ]);

  return resolveAtendimentoAccess(moduleActive, parametros?.menusVisiveis);
}
