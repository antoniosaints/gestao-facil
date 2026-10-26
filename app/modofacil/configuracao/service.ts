import { z } from "zod";
import type { PrismaClient } from "../../../generated";
import { ModoFacilError } from "../errors";

export const configuracaoSchema = z.object({
  modo: z.enum(["NORMAL", "FACIL"]),
  versao: z.number().int().min(0).max(2147483646),
}).strict();

export const permissionLevels: Record<string, number> = {
  root: 5, admin: 4, gerente: 3, vendedor: 2, tecnico: 2, usuario: 1,
};

export function podeAlterar(permissao: string) {
  return (permissionLevels[permissao] ?? 0) >= 4;
}

type Database = Pick<PrismaClient, "modoFacilConfiguracao">;

export async function getConfiguracao(db: Database, contaId: number, permissao: string) {
  const row = await db.modoFacilConfiguracao.findUnique({ where: { contaId } });
  return { modo: row?.modo ?? "NORMAL", versao: row?.versao ?? 0, podeAlterar: podeAlterar(permissao) };
}

export async function putConfiguracao(
  db: Database,
  session: { contaId: number; userId: number; permissao: string; impersonacao?: { sessaoId: number } },
  input: unknown,
) {
  if (!podeAlterar(session.permissao)) throw new ModoFacilError(403, "forbidden", "Somente administradores podem alterar a experiência.");
  const data = configuracaoSchema.parse(input);
  const audit = { alteradoPorId: session.userId, suporteSessaoId: session.impersonacao?.sessaoId ?? null };
  const conflict = () => new ModoFacilError(409, "version_conflict", "A experiência foi alterada em outra sessão. Recarregue a configuração.");
  if (data.versao === 0) {
    try {
      await db.modoFacilConfiguracao.create({ data: { contaId: session.contaId, modo: data.modo, versao: 1, ...audit } });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw conflict();
      throw error;
    }
  } else {
    const result = await db.modoFacilConfiguracao.updateMany({
      where: { contaId: session.contaId, versao: data.versao },
      data: { modo: data.modo, versao: { increment: 1 }, ...audit },
    });
    if (result.count !== 1) throw conflict();
  }
  // Return the version THIS write acquired, not a later concurrent writer's value.
  return { modo: data.modo, versao: data.versao + 1, podeAlterar: true };
}
