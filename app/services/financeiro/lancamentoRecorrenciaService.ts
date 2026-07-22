import { startOfDay } from "date-fns";
import type { Prisma, PrismaClient } from "../../../generated/client";
import { prisma } from "../../utils/prisma";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import {
  LIMITE_GERACAO_POR_EXECUCAO,
  avancarDataRecorrencia,
  estaNaJanelaDeGeracao,
  normalizarConfigRecorrencia,
  podeGerarOcorrencia,
  recalcularCursorRecorrencia,
  resolverAlvoPendentes,
  type ModoGeracaoRecorrencia,
  type RecorrenciaConfigPayload,
} from "./lancamentoRecorrenciaPolicy";

type DbClient = Prisma.TransactionClient | PrismaClient;

export type ResultadoGeracaoRecorrencia = {
  criadas: number;
  encerrada: boolean;
  proximoVencimento: Date | null;
  motivo:
    | "OK"
    | "SEM_RECORRENCIA"
    | "RECORRENCIA_INATIVA"
    | "RECORRENCIA_ENCERRADA"
    | "FIM_ATINGIDO"
    | "MAXIMO_EM_ABERTO"
    | "ALVO_ATINGIDO";
};

const RESULTADO_VAZIO: ResultadoGeracaoRecorrencia = {
  criadas: 0,
  encerrada: false,
  proximoVencimento: null,
  motivo: "SEM_RECORRENCIA",
};

/// Cria a configuração de recorrência de um lançamento recém-criado e já
/// completa as parcelas até o mínimo em aberto configurado.
export async function criarRecorrenciaLancamento(
  db: DbClient,
  args: {
    contaId: number;
    lancamentoId: number;
    valorParcela: string | number;
    payload: RecorrenciaConfigPayload;
    dataInicioFallback?: Date | string | null;
  },
) {
  const config = normalizarConfigRecorrencia(args.payload, {
    dataInicioFallback: args.dataInicioFallback,
  });

  // A primeira ocorrência já nasce com o lançamento; o cursor aponta para a próxima.
  const proximoVencimento = avancarDataRecorrencia(
    config.dataInicio,
    config.frequencia,
    config.intervaloDias,
  );
  const encerrada = Boolean(config.dataFim && proximoVencimento > config.dataFim);

  const recorrencia = await db.lancamentoRecorrencia.create({
    data: {
      contaId: args.contaId,
      lancamentoId: args.lancamentoId,
      ativo: !encerrada,
      valorParcela: args.valorParcela,
      frequencia: config.frequencia,
      intervaloDias: config.intervaloDias,
      dataInicio: config.dataInicio,
      dataFim: config.dataFim,
      minimoGerado: config.minimoGerado,
      maximoEmAberto: config.maximoEmAberto,
      geracaoAutomatica: config.geracaoAutomatica,
      diasAntecedencia: config.diasAntecedencia,
      proximoVencimento: encerrada ? null : proximoVencimento,
      totalGerado: 1,
      ultimaGeracaoEm: new Date(),
      encerradaEm: encerrada ? new Date() : null,
    },
  });

  const geracao = await gerarParcelasRecorrentes(db, args.lancamentoId, { modo: "MINIMO" });

  return { recorrencia, geracao };
}

/// Primitiva única de geração: completa as parcelas em aberto até o alvo,
/// respeitando o máximo em aberto e a data de fim.
export async function gerarParcelasRecorrentes(
  db: DbClient,
  lancamentoId: number,
  options?: { modo?: ModoGeracaoRecorrencia },
): Promise<ResultadoGeracaoRecorrencia> {
  const modo = options?.modo || "MINIMO";

  const recorrencia = await db.lancamentoRecorrencia.findUnique({
    where: { lancamentoId },
  });

  if (!recorrencia) return { ...RESULTADO_VAZIO };

  const lancamento = await db.lancamentoFinanceiro.findUnique({
    where: { id: lancamentoId },
    select: {
      id: true,
      formaPagamento: true,
      contasFinanceiroId: true,
      parcelas: {
        select: { id: true, numero: true, pago: true, vencimento: true },
      },
    },
  });

  if (!lancamento) return { ...RESULTADO_VAZIO };

  const parcelasValidas = lancamento.parcelas.filter((parcela) => parcela.numero !== 0);
  let pendentes = parcelasValidas.filter((parcela) => !parcela.pago).length;
  let numeroAtual = Math.max(0, ...lancamento.parcelas.map((parcela) => parcela.numero));
  let cursor = recorrencia.proximoVencimento ? startOfDay(recorrencia.proximoVencimento) : null;

  const alvoPendentes = resolverAlvoPendentes({
    modo,
    minimoGerado: recorrencia.minimoGerado,
    pendentes,
  });

  const novasParcelas: Prisma.ParcelaFinanceiroCreateManyInput[] = [];
  let encerrada = false;
  let motivo: ResultadoGeracaoRecorrencia["motivo"] = "OK";

  while (novasParcelas.length < LIMITE_GERACAO_POR_EXECUCAO) {
    const avaliacao = podeGerarOcorrencia({
      ativo: recorrencia.ativo,
      proximoVencimento: cursor,
      dataFim: recorrencia.dataFim,
      pendentes,
      alvoPendentes,
      maximoEmAberto: recorrencia.maximoEmAberto,
    });

    if (!avaliacao.permitido) {
      motivo = avaliacao.motivo;
      if (avaliacao.motivo === "FIM_ATINGIDO") {
        encerrada = true;
        cursor = null;
      }
      break;
    }

    numeroAtual += 1;
    novasParcelas.push({
      Uid: gerarIdUnicoComMetaFinal("PAR"),
      numero: numeroAtual,
      valor: recorrencia.valorParcela,
      vencimento: cursor as Date,
      pago: false,
      formaPagamento: lancamento.formaPagamento,
      lancamentoId,
      contaFinanceira: lancamento.contasFinanceiroId,
    });
    pendentes += 1;

    cursor = avancarDataRecorrencia(cursor as Date, recorrencia.frequencia, recorrencia.intervaloDias);

    // O fim da recorrência é detectado no próximo giro do laço, mas quando o alvo
    // já foi atingido precisamos encerrar aqui para não deixar cursor inválido.
    if (recorrencia.dataFim && cursor > startOfDay(recorrencia.dataFim)) {
      encerrada = true;
      cursor = null;
      break;
    }
  }

  if (novasParcelas.length) {
    await db.parcelaFinanceiro.createMany({ data: novasParcelas });
  }

  if (novasParcelas.length || encerrada) {
    await db.lancamentoRecorrencia.update({
      where: { id: recorrencia.id },
      data: {
        proximoVencimento: cursor,
        totalGerado: recorrencia.totalGerado + novasParcelas.length,
        ultimaGeracaoEm: novasParcelas.length ? new Date() : recorrencia.ultimaGeracaoEm,
        ...(encerrada ? { ativo: false, encerradaEm: new Date() } : {}),
      },
    });
  }

  return {
    criadas: novasParcelas.length,
    encerrada,
    proximoVencimento: cursor,
    motivo,
  };
}

/// Chamado após excluir parcela(s) de um lançamento recorrente: rebobina o
/// cursor para logo depois da última parcela que sobrou, para que a próxima
/// geração não pule os vencimentos removidos.
export async function sincronizarCursorRecorrencia(
  db: DbClient,
  lancamentoId: number | null | undefined,
) {
  if (!lancamentoId) return null;

  const recorrencia = await db.lancamentoRecorrencia.findUnique({
    where: { lancamentoId },
  });

  if (!recorrencia) return null;

  const ultima = await db.parcelaFinanceiro.findFirst({
    where: { lancamentoId, numero: { not: 0 } },
    select: { vencimento: true },
    orderBy: { vencimento: "desc" },
  });

  const { proximoVencimento, encerrada } = recalcularCursorRecorrencia({
    ultimoVencimento: ultima?.vencimento || null,
    dataInicio: recorrencia.dataInicio,
    dataFim: recorrencia.dataFim,
    frequencia: recorrencia.frequencia,
    intervaloDias: recorrencia.intervaloDias,
  });

  const cursorAtual = recorrencia.proximoVencimento
    ? startOfDay(recorrencia.proximoVencimento).getTime()
    : null;
  const cursorNovo = proximoVencimento ? proximoVencimento.getTime() : null;

  if (cursorAtual === cursorNovo) return recorrencia;

  return db.lancamentoRecorrencia.update({
    where: { id: recorrencia.id },
    data: {
      proximoVencimento,
      // Encerrar é automático; retomar continua sendo decisão do usuário, então
      // `ativo` nunca é religado aqui — apenas o marco de encerramento é limpo.
      ...(encerrada
        ? { ativo: false, encerradaEm: recorrencia.encerradaEm ?? new Date() }
        : { encerradaEm: null }),
    },
  });
}

/// Chamado após qualquer quitação de parcela: repõe as parcelas em aberto até o
/// mínimo configurado (com mínimo 1, pagar a última já cria a próxima).
export async function processarPosPagamentoRecorrencia(
  db: DbClient,
  lancamentoId: number | null | undefined,
): Promise<ResultadoGeracaoRecorrencia> {
  if (!lancamentoId) return { ...RESULTADO_VAZIO };
  return gerarParcelasRecorrentes(db, lancamentoId, { modo: "MINIMO" });
}

export type ResumoRecorrenciasAutomaticas = {
  checked: number;
  created: number;
  finished: number;
  failed: number;
  errors: string[];
};

/// Varredura do worker: gera a próxima ocorrência das recorrências com geração
/// automática quando a parcela vigente entra na janela de antecedência.
export async function processarRecorrenciasAutomaticas(
  referencia: Date = new Date(),
): Promise<ResumoRecorrenciasAutomaticas> {
  const resumo: ResumoRecorrenciasAutomaticas = {
    checked: 0,
    created: 0,
    finished: 0,
    failed: 0,
    errors: [],
  };

  const recorrencias = await prisma.lancamentoRecorrencia.findMany({
    where: {
      ativo: true,
      geracaoAutomatica: true,
      proximoVencimento: { not: null },
    },
    select: {
      id: true,
      lancamentoId: true,
      diasAntecedencia: true,
    },
  });

  for (const recorrencia of recorrencias) {
    resumo.checked += 1;

    try {
      const pendente = await prisma.parcelaFinanceiro.findFirst({
        where: {
          lancamentoId: recorrencia.lancamentoId,
          pago: false,
          numero: { not: 0 },
        },
        select: { vencimento: true },
        orderBy: { vencimento: "asc" },
      });

      const naJanela = estaNaJanelaDeGeracao({
        proximoVencimentoPendente: pendente?.vencimento || null,
        diasAntecedencia: recorrencia.diasAntecedencia,
        referencia,
      });

      if (!naJanela) continue;

      const resultado = await prisma.$transaction((tx) =>
        gerarParcelasRecorrentes(tx, recorrencia.lancamentoId, { modo: "PROXIMA" }),
      );

      resumo.created += resultado.criadas;
      if (resultado.encerrada) resumo.finished += 1;
    } catch (error: any) {
      resumo.failed += 1;
      resumo.errors.push(`recorrencia=${recorrencia.id}: ${error?.message || error}`);
    }
  }

  return resumo;
}
