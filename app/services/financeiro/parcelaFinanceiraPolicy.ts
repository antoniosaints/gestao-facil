import Decimal from "decimal.js";
import dayjs from "dayjs";

export type ParcelaStatusInput = {
  pago: boolean;
  vencimento: Date | string;
};

export type ParcelaValorInput = {
  valor: Decimal.Value;
};

export function canDeleteParcelaFinanceira(parcela: { pago: boolean }) {
  return !parcela.pago;
}

export type ParcelaLoteInput = {
  id: number;
  numero: number;
  pago: boolean;
  lancamentoId: number;
  temCobranca: boolean;
};

export type ParcelaIgnorada = { id: number; motivo: string };

export type ResultadoLote = { aplicar: number[]; ignoradas: ParcelaIgnorada[] };

export const MOTIVO_JA_EFETIVADA = "Parcela já efetivada.";
export const MOTIVO_NAO_EFETIVADA = "Parcela não está efetivada.";
export const MOTIVO_APENAS_PENDENTES = "Apenas parcelas pendentes podem ser excluídas.";
export const MOTIVO_COM_COBRANCA = "Possui cobrança vinculada.";
export const MOTIVO_MINIMO_UMA_PARCELA = "O lançamento deve manter ao menos uma parcela.";

function ordenarParcelas(parcelas: ParcelaLoteInput[]) {
  return [...parcelas].sort((a, b) => (a.numero !== b.numero ? a.numero - b.numero : a.id - b.id));
}

export function separarParcelasParaEfetivar(parcelas: ParcelaLoteInput[]): ResultadoLote {
  const aplicar: number[] = [];
  const ignoradas: ParcelaIgnorada[] = [];

  for (const parcela of ordenarParcelas(parcelas)) {
    if (parcela.pago) {
      ignoradas.push({ id: parcela.id, motivo: MOTIVO_JA_EFETIVADA });
      continue;
    }
    aplicar.push(parcela.id);
  }

  return { aplicar, ignoradas };
}

export function separarParcelasParaEstornar(parcelas: ParcelaLoteInput[]): ResultadoLote {
  const aplicar: number[] = [];
  const ignoradas: ParcelaIgnorada[] = [];

  for (const parcela of ordenarParcelas(parcelas)) {
    if (!parcela.pago) {
      ignoradas.push({ id: parcela.id, motivo: MOTIVO_NAO_EFETIVADA });
      continue;
    }
    aplicar.push(parcela.id);
  }

  return { aplicar, ignoradas };
}

export function separarParcelasParaExcluir(
  parcelas: ParcelaLoteInput[],
  totalParcelasPorLancamento: Record<number, number>,
): ResultadoLote {
  const ignoradas: ParcelaIgnorada[] = [];
  const candidatasPorLancamento = new Map<number, ParcelaLoteInput[]>();

  for (const parcela of ordenarParcelas(parcelas)) {
    if (parcela.pago) {
      ignoradas.push({ id: parcela.id, motivo: MOTIVO_APENAS_PENDENTES });
      continue;
    }

    if (parcela.temCobranca) {
      ignoradas.push({ id: parcela.id, motivo: MOTIVO_COM_COBRANCA });
      continue;
    }

    const candidatas = candidatasPorLancamento.get(parcela.lancamentoId) ?? [];
    candidatas.push(parcela);
    candidatasPorLancamento.set(parcela.lancamentoId, candidatas);
  }

  const aplicar: number[] = [];

  for (const [lancamentoId, candidatas] of candidatasPorLancamento) {
    const total = totalParcelasPorLancamento[lancamentoId] ?? candidatas.length;
    // O lançamento não pode ficar sem nenhuma parcela: a de menor número é preservada.
    const preservar = total - candidatas.length < 1 ? candidatas[0] : null;

    for (const candidata of candidatas) {
      if (preservar && candidata.id === preservar.id) {
        ignoradas.push({ id: candidata.id, motivo: MOTIVO_MINIMO_UMA_PARCELA });
        continue;
      }
      aplicar.push(candidata.id);
    }
  }

  return { aplicar, ignoradas };
}

export function sumParcelasFinanceiras(parcelas: ParcelaValorInput[]) {
  return parcelas.reduce((acc, parcela) => acc.plus(new Decimal(parcela.valor || 0)), new Decimal(0));
}

export function resolveLancamentoStatusFromParcelas(
  parcelas: ParcelaStatusInput[],
  referenceDate: Date = new Date(),
) {
  if (!parcelas.length) return "PENDENTE" as const;

  const hoje = dayjs(referenceDate).startOf("day").toDate();
  const totalParcelas = parcelas.length;
  const parcelasPagas = parcelas.filter((parcela) => parcela.pago).length;
  const parcelasVencidas = parcelas.filter(
    (parcela) => !parcela.pago && dayjs(parcela.vencimento).isBefore(hoje),
  ).length;

  if (parcelasPagas === totalParcelas) return "PAGO" as const;
  if (parcelasPagas > 0 && parcelasPagas < totalParcelas) return "PARCIAL" as const;
  if (parcelasVencidas > 0) return "ATRASADO" as const;
  return "PENDENTE" as const;
}
