import { FunctionDeclaration, SchemaType } from "@google/generative-ai";
import Decimal from "decimal.js";
import { endOfDay, endOfMonth, startOfDay, startOfMonth } from "date-fns";

import { CustomData } from "../../../helpers/getCustomRequest";
import { hasPermission } from "../../../helpers/userPermission";
import { montarKpisNegocio } from "../../../services/ia/iaAnalyticsService";
import { montarDemonstrativo } from "../../../services/financeiro/demonstrativoService";
import { normalizeRegime } from "../../../services/financeiro/demonstrativoPolicy";

/// Converte as datas que a IA envia em texto. Sem período válido, assume o mês
/// atual — o prompt manda declarar a suposição ao usuário.
export function resolverPeriodoIa(inicio?: string, fim?: string) {
  const hoje = new Date();
  const dataInicio = inicio ? startOfDay(new Date(inicio)) : startOfMonth(hoje);
  const dataFim = fim ? endOfDay(new Date(fim)) : endOfMonth(hoje);

  if (Number.isNaN(dataInicio.getTime()) || Number.isNaN(dataFim.getTime())) {
    return { inicio: startOfMonth(hoje), fim: endOfMonth(hoje), assumido: true };
  }

  if (dataFim < dataInicio) {
    return { inicio: dataFim, fim: dataInicio, assumido: true };
  }

  return { inicio: dataInicio, fim: dataFim, assumido: !inicio || !fim };
}

const brl = (valor: Decimal.Value) =>
  Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const pct = (valor: number | null) => (valor === null ? "sem base anterior" : `${valor.toFixed(1)}%`);

export const systemFunctionsAnaliseIA = {
  getPanoramaNegocio: async (
    args: { inicio?: string; fim?: string },
    request: CustomData,
  ) => {
    const auth = await hasPermission(request, 3);
    if (!auth) return { error: "Acesso negado, informe o usuario que ele nao tem permissao." };

    const periodo = resolverPeriodoIa(args?.inicio, args?.fim);
    const kpis = await montarKpisNegocio(request.contaId, periodo.inicio, periodo.fim);

    return {
      ...kpis,
      periodoAssumido: periodo.assumido,
      observacao: periodo.assumido
        ? "O usuario nao informou o periodo completo; foi assumido o mes atual. Informe isso na resposta."
        : undefined,
    };
  },

  getDemonstrativoFinanceiro: async (
    args: { inicio?: string; fim?: string; regime?: string },
    request: CustomData,
  ) => {
    const auth = await hasPermission(request, 3);
    if (!auth) return { error: "Acesso negado, informe o usuario que ele nao tem permissao." };

    const periodo = resolverPeriodoIa(args?.inicio, args?.fim);
    const regime = normalizeRegime(args?.regime);

    const dre = await montarDemonstrativo(request.contaId, {
      inicio: periodo.inicio,
      fim: periodo.fim,
      regime,
      // A série mensal não interessa ao chat; o mínimo evita carregar meses à toa.
      mesesHistorico: 1,
    });

    // Achata para texto pronto: o modelo não deve reformatar Decimal nem recalcular %.
    const mapearLinhas = (linhas: typeof dre.grupos.receitas) =>
      linhas.map((linha) => ({
        categoria: linha.nome,
        valor: brl(linha.valor),
        participacaoSobreReceita: `${linha.participacao.toFixed(1)}%`,
        periodoAnterior: brl(linha.anterior),
        variacao: pct(linha.variacao),
        detalhe:
          linha.subcategorias.length > 1
            ? linha.subcategorias.map((sub) => ({ categoria: sub.nome, valor: brl(sub.valor) }))
            : undefined,
      }));

    return {
      periodo: {
        inicio: periodo.inicio.toISOString().slice(0, 10),
        fim: periodo.fim.toISOString().slice(0, 10),
        regime: regime === "CAIXA" ? "caixa (pagamentos efetivados)" : "competencia (vencimentos)",
        assumido: periodo.assumido,
      },
      comparativo: {
        inicio: dre.periodo.anterior.inicio.toISOString().slice(0, 10),
        fim: dre.periodo.anterior.fim.toISOString().slice(0, 10),
      },
      resultado: {
        receitas: brl(dre.resumo.receitas),
        despesas: brl(dre.resumo.despesas),
        resultado: brl(dre.resumo.resultado),
        margem: `${dre.resumo.margem.toFixed(1)}%`,
        variacaoReceitas: pct(dre.resumo.variacao.receitas),
        variacaoDespesas: pct(dre.resumo.variacao.despesas),
        variacaoResultado: pct(dre.resumo.variacao.resultado),
      },
      receitasPorCategoria: mapearLinhas(dre.grupos.receitas),
      despesasPorCategoria: mapearLinhas(dre.grupos.despesas),
    };
  },
};

export const toolsAnalise: FunctionDeclaration[] = [
  {
    name: "getPanoramaNegocio",
    description:
      "Panorama do negocio em um periodo, com numeros JA CALCULADOS: faturamento, quantidade de vendas, ticket medio, variacao contra o periodo anterior, receitas/despesas/saldo, lancamentos pendentes, estoque baixo e total de clientes. Use SEMPRE que o usuario pedir uma visao geral, perguntar 'como foi o mes', 'como esta o negocio' ou quiser comparar periodos. Nunca some esses valores manualmente.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        inicio: { type: SchemaType.STRING, description: "Data inicial no formato AAAA-MM-DD (opcional, padrao: inicio do mes atual)" },
        fim: { type: SchemaType.STRING, description: "Data final no formato AAAA-MM-DD (opcional, padrao: fim do mes atual)" },
      },
    },
  },
  {
    name: "getDemonstrativoFinanceiro",
    description:
      "Demonstrativo do resultado (DRE) do periodo, com receitas e despesas agrupadas por categoria do plano de contas, ja com percentual sobre a receita, comparacao com o periodo anterior, resultado e margem. Use para perguntas de lucro, margem, 'onde estou gastando', 'por que caiu', analise de custos e comparacao entre periodos. Todos os valores vem calculados: nao refaca contas.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        inicio: { type: SchemaType.STRING, description: "Data inicial no formato AAAA-MM-DD (opcional, padrao: inicio do mes atual)" },
        fim: { type: SchemaType.STRING, description: "Data final no formato AAAA-MM-DD (opcional, padrao: fim do mes atual)" },
        regime: {
          type: SchemaType.STRING,
          description:
            "COMPETENCIA (padrao, reconhece pelo vencimento incluindo o que esta em aberto) ou CAIXA (so o que foi efetivamente pago).",
        },
      },
    },
  },
];
