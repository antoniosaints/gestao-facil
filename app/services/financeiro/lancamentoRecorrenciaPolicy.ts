import { addDays, addMonths, addWeeks, addYears, startOfDay } from "date-fns";

export type FrequenciaRecorrencia =
  | "DIARIO"
  | "SEMANAL"
  | "QUINZENAL"
  | "MENSAL"
  | "TRIMESTRAL"
  | "SEMESTRAL"
  | "ANUAL"
  | "PERSONALIZADO";

export type ModoGeracaoRecorrencia =
  /// Mantém apenas o mínimo de parcelas em aberto configurado.
  | "MINIMO"
  /// Gera uma ocorrência além das que já estão em aberto (worker / botão manual).
  | "PROXIMA";

export type RecorrenciaConfigPayload = {
  frequencia?: string | null;
  intervaloDias?: number | string | null;
  dataInicio?: string | Date | null;
  dataFim?: string | Date | null;
  minimoGerado?: number | string | null;
  maximoEmAberto?: number | string | null;
  geracaoAutomatica?: boolean | null;
  diasAntecedencia?: number | string | null;
  valorParcela?: number | string | null;
};

export type RecorrenciaConfigNormalizada = {
  frequencia: FrequenciaRecorrencia;
  intervaloDias: number | null;
  dataInicio: Date;
  dataFim: Date | null;
  minimoGerado: number;
  maximoEmAberto: number;
  geracaoAutomatica: boolean;
  diasAntecedencia: number;
};

export const FREQUENCIAS_RECORRENCIA: FrequenciaRecorrencia[] = [
  "DIARIO",
  "SEMANAL",
  "QUINZENAL",
  "MENSAL",
  "TRIMESTRAL",
  "SEMESTRAL",
  "ANUAL",
  "PERSONALIZADO",
];

/// Teto de segurança por execução: mesmo com config esquisita, nunca geramos
/// uma avalanche de parcelas em uma única chamada.
export const LIMITE_GERACAO_POR_EXECUCAO = 24;
export const MAXIMO_EM_ABERTO_LIMITE = 60;
export const MINIMO_GERADO_LIMITE = 24;

export function normalizeFrequenciaRecorrencia(valor?: string | null): FrequenciaRecorrencia {
  const frequencia = (valor || "").toUpperCase() as FrequenciaRecorrencia;
  return FREQUENCIAS_RECORRENCIA.includes(frequencia) ? frequencia : "MENSAL";
}

export function avancarDataRecorrencia(
  base: Date | string,
  frequencia: FrequenciaRecorrencia,
  intervaloDias?: number | null,
) {
  const inicio = startOfDay(new Date(base));

  switch (frequencia) {
    case "DIARIO":
      return startOfDay(addDays(inicio, 1));
    case "SEMANAL":
      return startOfDay(addWeeks(inicio, 1));
    case "QUINZENAL":
      return startOfDay(addDays(inicio, 15));
    case "TRIMESTRAL":
      return startOfDay(addMonths(inicio, 3));
    case "SEMESTRAL":
      return startOfDay(addMonths(inicio, 6));
    case "ANUAL":
      return startOfDay(addYears(inicio, 1));
    case "PERSONALIZADO": {
      const intervalo = Number(intervaloDias || 0);
      if (!Number.isInteger(intervalo) || intervalo < 1) {
        throw new Error("Informe a quantidade de dias da recorrência personalizada.");
      }
      return startOfDay(addDays(inicio, intervalo));
    }
    case "MENSAL":
    default:
      return startOfDay(addMonths(inicio, 1));
  }
}

function parseInteiro(valor: number | string | null | undefined, padrao: number) {
  if (valor === null || valor === undefined || valor === "") return padrao;
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.trunc(numero);
}

export function normalizarConfigRecorrencia(
  payload: RecorrenciaConfigPayload,
  options?: { dataInicioFallback?: Date | string | null },
): RecorrenciaConfigNormalizada {
  const frequencia = normalizeFrequenciaRecorrencia(payload.frequencia);
  const intervaloDias =
    payload.intervaloDias === null || payload.intervaloDias === undefined || payload.intervaloDias === ""
      ? null
      : Number(payload.intervaloDias);

  if (frequencia === "PERSONALIZADO" && (!Number.isInteger(intervaloDias) || Number(intervaloDias) < 1)) {
    throw new Error("Informe a quantidade de dias da recorrência personalizada.");
  }

  const dataInicioBruta = payload.dataInicio || options?.dataInicioFallback;
  if (!dataInicioBruta || Number.isNaN(new Date(dataInicioBruta).getTime())) {
    throw new Error("Informe uma data de início válida para a recorrência.");
  }
  const dataInicio = startOfDay(new Date(dataInicioBruta));

  let dataFim: Date | null = null;
  if (payload.dataFim) {
    if (Number.isNaN(new Date(payload.dataFim).getTime())) {
      throw new Error("Informe uma data de fim válida para a recorrência.");
    }
    dataFim = startOfDay(new Date(payload.dataFim));
    if (dataFim < dataInicio) {
      throw new Error("A data de fim da recorrência deve ser posterior à data de início.");
    }
  }

  const minimoGerado = parseInteiro(payload.minimoGerado, 1);
  if (minimoGerado < 1 || minimoGerado > MINIMO_GERADO_LIMITE) {
    throw new Error(`O mínimo de parcelas em aberto deve ficar entre 1 e ${MINIMO_GERADO_LIMITE}.`);
  }

  const maximoEmAberto = parseInteiro(payload.maximoEmAberto, Math.max(6, minimoGerado));
  if (maximoEmAberto < minimoGerado) {
    throw new Error("O máximo de parcelas em aberto não pode ser menor que o mínimo.");
  }
  if (maximoEmAberto > MAXIMO_EM_ABERTO_LIMITE) {
    throw new Error(`O máximo de parcelas em aberto deve ser de até ${MAXIMO_EM_ABERTO_LIMITE}.`);
  }

  const geracaoAutomatica = Boolean(payload.geracaoAutomatica);
  const diasAntecedencia = parseInteiro(payload.diasAntecedencia, 30);
  if (geracaoAutomatica && (diasAntecedencia < 0 || diasAntecedencia > 365)) {
    throw new Error("Os dias de antecedência da geração automática devem ficar entre 0 e 365.");
  }

  return {
    frequencia,
    intervaloDias: frequencia === "PERSONALIZADO" ? Number(intervaloDias) : null,
    dataInicio,
    dataFim,
    minimoGerado,
    maximoEmAberto,
    geracaoAutomatica,
    diasAntecedencia,
  };
}

/// Quantas parcelas em aberto a recorrência deve ter ao final da execução.
export function resolverAlvoPendentes(args: {
  modo: ModoGeracaoRecorrencia;
  minimoGerado: number;
  pendentes: number;
}) {
  if (args.modo === "PROXIMA") {
    return Math.max(args.minimoGerado, args.pendentes + 1);
  }
  return args.minimoGerado;
}

/// A recorrência automática só é acionada quando a parcela vigente entra na
/// janela de antecedência (ou quando não há nenhuma parcela em aberto).
export function estaNaJanelaDeGeracao(args: {
  proximoVencimentoPendente: Date | null;
  diasAntecedencia: number;
  referencia: Date;
}) {
  if (!args.proximoVencimentoPendente) return true;
  const limite = startOfDay(addDays(startOfDay(args.referencia), Math.max(0, args.diasAntecedencia)));
  return startOfDay(args.proximoVencimentoPendente) <= limite;
}

export function podeGerarOcorrencia(args: {
  ativo: boolean;
  proximoVencimento: Date | null;
  dataFim: Date | null;
  pendentes: number;
  alvoPendentes: number;
  maximoEmAberto: number;
}) {
  if (!args.ativo) return { permitido: false, motivo: "RECORRENCIA_INATIVA" as const };
  if (!args.proximoVencimento) return { permitido: false, motivo: "RECORRENCIA_ENCERRADA" as const };
  if (args.dataFim && startOfDay(args.proximoVencimento) > startOfDay(args.dataFim)) {
    return { permitido: false, motivo: "FIM_ATINGIDO" as const };
  }
  if (args.pendentes >= args.maximoEmAberto) {
    return { permitido: false, motivo: "MAXIMO_EM_ABERTO" as const };
  }
  if (args.pendentes >= args.alvoPendentes) {
    return { permitido: false, motivo: "ALVO_ATINGIDO" as const };
  }
  return { permitido: true, motivo: "OK" as const };
}
