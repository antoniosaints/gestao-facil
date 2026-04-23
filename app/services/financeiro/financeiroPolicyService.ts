import { endOfDay, isAfter, isBefore, startOfDay } from "date-fns";
import { prisma } from "../../utils/prisma";

export type FinanceiroFeatureFlags = {
  permitirLancamentoRetroativo: boolean;
  permitirEfetivacaoFutura: boolean;
  permitirTransferenciaContaFinanceira: boolean;
  permitirCriacaoCobranca: boolean;
};

const DEFAULT_FLAGS: FinanceiroFeatureFlags = {
  permitirLancamentoRetroativo: true,
  permitirEfetivacaoFutura: true,
  permitirTransferenciaContaFinanceira: true,
  permitirCriacaoCobranca: true,
};

export async function getFinanceiroFeatureFlags(contaId: number): Promise<FinanceiroFeatureFlags> {
  const parametros = await prisma.parametrosConta.findUnique({
    where: { contaId },
    select: {
      permitirLancamentoRetroativo: true,
      permitirEfetivacaoFutura: true,
      permitirTransferenciaContaFinanceira: true,
      permitirCriacaoCobranca: true,
    },
  });

  if (!parametros) {
    return DEFAULT_FLAGS;
  }

  return {
    permitirLancamentoRetroativo: parametros.permitirLancamentoRetroativo ?? true,
    permitirEfetivacaoFutura: parametros.permitirEfetivacaoFutura ?? true,
    permitirTransferenciaContaFinanceira: parametros.permitirTransferenciaContaFinanceira ?? true,
    permitirCriacaoCobranca: parametros.permitirCriacaoCobranca ?? true,
  };
}

export async function assertLancamentoDateAllowed(contaId: number, dataReferencia: Date | string) {
  const flags = await getFinanceiroFeatureFlags(contaId);

  if (flags.permitirLancamentoRetroativo) {
    return flags;
  }

  const hoje = startOfDay(new Date());
  const data = startOfDay(new Date(dataReferencia));

  if (Number.isNaN(data.getTime())) {
    throw new Error("Informe uma data válida para o lançamento.");
  }

  if (isBefore(data, hoje)) {
    throw new Error("Esta conta não permite lançamentos com data retroativa.");
  }

  return flags;
}

export async function assertFutureSettlementAllowed(contaId: number, datas: Array<Date | string | null | undefined>) {
  const flags = await getFinanceiroFeatureFlags(contaId);

  if (flags.permitirEfetivacaoFutura) {
    return flags;
  }

  const limite = endOfDay(new Date());
  const possuiDataFutura = datas.some((value) => {
    if (!value) return false;
    const data = new Date(value);
    if (Number.isNaN(data.getTime())) return false;
    return isAfter(data, limite);
  });

  if (possuiDataFutura) {
    throw new Error("Esta conta não permite efetivação de lançamentos com data futura.");
  }

  return flags;
}

export async function assertTransferAllowed(contaId: number) {
  const flags = await getFinanceiroFeatureFlags(contaId);

  if (!flags.permitirTransferenciaContaFinanceira) {
    throw new Error("As transferências entre contas financeiras estão bloqueadas para esta conta.");
  }

  return flags;
}

export async function assertChargeCreationAllowed(contaId: number) {
  const flags = await getFinanceiroFeatureFlags(contaId);

  if (!flags.permitirCriacaoCobranca) {
    throw new Error("A criação de cobranças está bloqueada nas configurações financeiras desta conta.");
  }

  return flags;
}
