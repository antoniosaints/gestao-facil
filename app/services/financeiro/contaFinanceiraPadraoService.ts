import type { Prisma, PrismaClient } from "../../../generated/client";

type DbClient = Prisma.TransactionClient | PrismaClient;

function normalizeContaFinanceiraId(value?: number | string | null) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function resolveContaFinanceiraPadrao(
  db: DbClient,
  contaId: number,
  contaFinanceiraId?: number | string | null,
) {
  const explicitId = normalizeContaFinanceiraId(contaFinanceiraId);

  if (explicitId) {
    const conta = await db.contasFinanceiro.findFirst({
      where: { id: explicitId, contaId },
      select: { id: true },
    });

    if (!conta) {
      throw new Error("Conta financeira invalida para esta conta.");
    }

    return explicitId;
  }

  const parametros = await (db.parametrosConta as any).findUnique({
    where: { contaId },
    select: { contaFinanceiraPadraoId: true },
  });
  const defaultId = normalizeContaFinanceiraId(parametros?.contaFinanceiraPadraoId);

  if (!defaultId) return null;

  const conta = await db.contasFinanceiro.findFirst({
    where: { id: defaultId, contaId },
    select: { id: true },
  });

  return conta ? defaultId : null;
}

export async function requireContaFinanceiraPadrao(
  db: DbClient,
  contaId: number,
  contaFinanceiraId?: number | string | null,
) {
  const resolvedId = await resolveContaFinanceiraPadrao(db, contaId, contaFinanceiraId);

  if (!resolvedId) {
    throw new Error("Informe uma conta financeira ou configure uma conta financeira padrao em Configuracoes > Financeiro.");
  }

  return resolvedId;
}
