import type { Prisma } from "../../../generated";

const INTERNAL_CHARGE_PATTERNS = [
  "App Store",
  "Liberacao proporcional do app",
  "Primeira mensalidade do app",
  "Mensalidade do plano Gestão Fácil",
  "Mensalidade do plano Gestao Facil",
  "Assinatura do plano",
] as const;

export function isInternalSystemCharge(charge: {
  observacao?: string | null;
  moduloOnContaAtual?: unknown | null;
}) {
  if (charge.moduloOnContaAtual) {
    return true;
  }

  const observacao = charge.observacao || "";
  return INTERNAL_CHARGE_PATTERNS.some((pattern) => observacao.includes(pattern));
}

export function buildOperationalChargeWhere(contaId: number): Prisma.CobrancasFinanceirasWhereInput {
  return {
    contaId,
    NOT: INTERNAL_CHARGE_PATTERNS.map((pattern) => ({
      observacao: {
        contains: pattern,
      },
    })),
  };
}

export function assertOperationalCharge(charge: {
  observacao?: string | null;
  moduloOnContaAtual?: unknown | null;
}) {
  if (isInternalSystemCharge(charge)) {
    throw new Error(
      "Cobranças internas de assinatura/plano não podem ser gerenciadas no contexto operacional da conta.",
    );
  }
}

export function isStoreModuleCharge(observacao?: string | null) {
  return isInternalSystemCharge({ observacao });
}
