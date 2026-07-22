import Decimal from "decimal.js";
import { startOfMonth, subMonths } from "date-fns";
import { prisma } from "../../utils/prisma";
import {
  agruparPorCategoria,
  calcularParticipacao,
  calcularVariacao,
  getValorReconhecido,
  montarSerieMensal,
  parcelaNoPeriodo,
  resolvePeriodoAnterior,
  type ParcelaDemonstrativo,
  type RegimeDemonstrativo,
} from "./demonstrativoPolicy";

export type FiltrosDemonstrativo = {
  inicio: Date;
  fim: Date;
  regime: RegimeDemonstrativo;
  contaFinanceiraId?: number | null;
  categoriaId?: number | null;
  clienteId?: number | null;
  /// Quantos meses a série do gráfico deve cobrir, contados a partir do fim do
  /// período. Independe do filtro para que "este mês" não vire uma barra só.
  mesesHistorico?: number | null;
};

export const MESES_HISTORICO_PADRAO = 12;
const MESES_HISTORICO_LIMITE = 36;

type PeriodoParcela = "ATUAL" | "ANTERIOR" | "FORA";
type ParcelaCarregada = ParcelaDemonstrativo & { periodo: PeriodoParcela };

/// Carrega as parcelas da janela inteira de uma vez. O recorte fino por regime
/// fica na policy, para não duplicar a regra de reconhecimento em SQL.
async function carregarParcelas(
  contaId: number,
  filtros: FiltrosDemonstrativo,
  janelaInicio: Date,
  janelaFim: Date,
): Promise<ParcelaDemonstrativo[]> {
  const registros = await prisma.parcelaFinanceiro.findMany({
    where: {
      ...(filtros.contaFinanceiraId ? { contaFinanceira: filtros.contaFinanceiraId } : {}),
      OR: [
        { vencimento: { gte: janelaInicio, lte: janelaFim } },
        { dataPagamento: { gte: janelaInicio, lte: janelaFim } },
      ],
      lancamento: {
        contaId,
        ...(filtros.categoriaId ? { categoriaId: filtros.categoriaId } : {}),
        ...(filtros.clienteId ? { clienteId: filtros.clienteId } : {}),
      },
    },
    select: {
      valor: true,
      valorPago: true,
      vencimento: true,
      dataPagamento: true,
      pago: true,
      lancamento: {
        select: {
          tipo: true,
          categoriaId: true,
        },
      },
    },
  });

  return registros.map((registro) => ({
    valor: registro.valor,
    valorPago: registro.valorPago,
    vencimento: registro.vencimento,
    dataPagamento: registro.dataPagamento,
    pago: registro.pago,
    tipo: registro.lancamento.tipo,
    categoriaId: registro.lancamento.categoriaId,
  }));
}

function somar(parcelas: ParcelaCarregada[], regime: RegimeDemonstrativo, tipo: "RECEITA" | "DESPESA", periodo: "ATUAL" | "ANTERIOR") {
  return parcelas
    .filter((parcela) => parcela.tipo === tipo && parcela.periodo === periodo)
    .reduce((acc, parcela) => acc.plus(getValorReconhecido(parcela, regime)), new Decimal(0));
}

export async function montarDemonstrativo(contaId: number, filtros: FiltrosDemonstrativo) {
  const anterior = resolvePeriodoAnterior(filtros.inicio, filtros.fim);

  const meses = Math.min(
    Math.max(Number(filtros.mesesHistorico || MESES_HISTORICO_PADRAO), 1),
    MESES_HISTORICO_LIMITE,
  );

  // A série do gráfico tem horizonte próprio: recua `meses` a partir do fim do
  // período e nunca mostra menos do que o próprio período filtrado.
  const inicioJanelaMeses = startOfMonth(subMonths(startOfMonth(filtros.fim), meses - 1));
  const serieInicio =
    inicioJanelaMeses < startOfMonth(filtros.inicio) ? inicioJanelaMeses : startOfMonth(filtros.inicio);

  // A consulta cobre o mais antigo entre o comparativo e a série.
  const janelaInicio = anterior.inicio < serieInicio ? anterior.inicio : serieInicio;

  const [parcelas, categorias] = await Promise.all([
    carregarParcelas(contaId, filtros, janelaInicio, filtros.fim),
    prisma.categoriaFinanceiro.findMany({
      where: { contaId },
      select: { id: true, nome: true, parentId: true },
    }),
  ]);

  const classificadas: ParcelaCarregada[] = parcelas.map((parcela) => ({
    ...parcela,
    periodo: parcelaNoPeriodo(parcela, filtros.regime, filtros.inicio, filtros.fim)
      ? "ATUAL"
      : parcelaNoPeriodo(parcela, filtros.regime, anterior.inicio, anterior.fim)
        ? "ANTERIOR"
        : "FORA",
  }));

  // Totais e agrupamento olham só o período filtrado e o comparativo; o resto da
  // janela existe apenas para desenhar a série mensal.
  const doDemonstrativo = classificadas.filter(
    (parcela): parcela is ParcelaCarregada & { periodo: "ATUAL" | "ANTERIOR" } => parcela.periodo !== "FORA",
  );

  const receitas = somar(doDemonstrativo, filtros.regime, "RECEITA", "ATUAL");
  const despesas = somar(doDemonstrativo, filtros.regime, "DESPESA", "ATUAL");
  const receitasAnterior = somar(doDemonstrativo, filtros.regime, "RECEITA", "ANTERIOR");
  const despesasAnterior = somar(doDemonstrativo, filtros.regime, "DESPESA", "ANTERIOR");

  const resultado = receitas.minus(despesas);
  const resultadoAnterior = receitasAnterior.minus(despesasAnterior);

  // A análise vertical usa a receita do período como 100%, convenção do DRE.
  const base = receitas;

  const parcelasAtuais = doDemonstrativo.filter((parcela) => parcela.periodo === "ATUAL");

  return {
    periodo: {
      inicio: filtros.inicio,
      fim: filtros.fim,
      regime: filtros.regime,
      anterior: { inicio: anterior.inicio, fim: anterior.fim },
      serie: { inicio: serieInicio, fim: filtros.fim, meses },
    },
    resumo: {
      receitas,
      despesas,
      resultado,
      margem: calcularParticipacao(resultado, base),
      anterior: {
        receitas: receitasAnterior,
        despesas: despesasAnterior,
        resultado: resultadoAnterior,
      },
      variacao: {
        receitas: calcularVariacao(receitas, receitasAnterior),
        despesas: calcularVariacao(despesas, despesasAnterior),
        resultado: calcularVariacao(resultado, resultadoAnterior),
      },
      totalLancamentos: parcelasAtuais.length,
    },
    grupos: {
      receitas: agruparPorCategoria(doDemonstrativo, categorias, filtros.regime, "RECEITA", base),
      despesas: agruparPorCategoria(doDemonstrativo, categorias, filtros.regime, "DESPESA", base),
    },
    // A série usa a janela inteira para dar contexto de tendência ao período filtrado.
    mensal: montarSerieMensal(classificadas, filtros.regime, serieInicio, filtros.fim),
  };
}

export type DemonstrativoPayload = Awaited<ReturnType<typeof montarDemonstrativo>>;
