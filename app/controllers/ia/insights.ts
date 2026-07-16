import { Request, Response } from "express";
import { z } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";
import { generateText } from "../../services/ia/iaTextService";
import { getThisMonth } from "../dashboard/hooks";
import { handleIaError } from "./helpers";

const schema = z.object({
  inicio: z.string().optional().nullable(),
  fim: z.string().optional().nullable(),
});

const num = (d: any) => Number(d ?? 0);
const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Monta um JSON compacto de KPIs do período (vendas, financeiro, estoque, clientes)
// para a IA analisar. Reaproveita os mesmos critérios do dashboard (vendas efetivadas).
async function montarKpis(contaId: number, inicio: Date, fim: Date) {
  const duracao = fim.getTime() - inicio.getTime();
  const prevFim = new Date(inicio.getTime() - 1);
  const prevInicio = new Date(prevFim.getTime() - duracao);
  const statusVendaEfetiva = ["FATURADO", "FINALIZADO"] as const;

  const [vendasAtual, vendasAnterior, finGrupos, pendencias, produtos, clientes] =
    await Promise.all([
      prisma.vendas.aggregate({
        _sum: { valor: true },
        _count: { _all: true },
        where: { contaId, status: { in: statusVendaEfetiva as any }, data: { gte: inicio, lte: fim } },
      }),
      prisma.vendas.aggregate({
        _sum: { valor: true },
        _count: { _all: true },
        where: { contaId, status: { in: statusVendaEfetiva as any }, data: { gte: prevInicio, lte: prevFim } },
      }),
      prisma.lancamentoFinanceiro.groupBy({
        by: ["tipo"],
        _sum: { valorTotal: true },
        where: { contaId, dataLancamento: { gte: inicio, lte: fim } },
      }),
      prisma.lancamentoFinanceiro.count({
        where: { contaId, status: { in: ["PENDENTE", "ATRASADO"] }, dataLancamento: { gte: inicio, lte: fim } },
      }),
      prisma.produto.findMany({
        where: { contaId, controlaEstoque: true },
        select: { nome: true, nomeVariante: true, estoque: true, minimo: true },
        orderBy: { estoque: "asc" },
      }),
      prisma.clientesFornecedores.count({ where: { contaId } }),
    ]);

  const totalVendas = num(vendasAtual._sum.valor);
  const qtdVendas = vendasAtual._count._all;
  const totalVendasAnt = num(vendasAnterior._sum.valor);
  const variacaoVendas = totalVendasAnt > 0 ? ((totalVendas - totalVendasAnt) / totalVendasAnt) * 100 : null;

  const receitas = num(finGrupos.find((g) => g.tipo === "RECEITA")?._sum.valorTotal);
  const despesas = num(finGrupos.find((g) => g.tipo === "DESPESA")?._sum.valorTotal);

  const baixos = produtos.filter((p) => p.estoque > 0 && p.estoque <= p.minimo);
  const zerados = produtos.filter((p) => p.estoque <= 0);
  const nomeProduto = (p: any) => [p.nome, p.nomeVariante].filter(Boolean).join(" ");

  return {
    periodo: { inicio: inicio.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) },
    vendas: {
      total: brl(totalVendas),
      quantidade: qtdVendas,
      ticketMedio: brl(qtdVendas > 0 ? totalVendas / qtdVendas : 0),
      variacaoVsPeriodoAnterior: variacaoVendas == null ? "sem base anterior" : `${variacaoVendas.toFixed(1)}%`,
    },
    financeiro: {
      receitas: brl(receitas),
      despesas: brl(despesas),
      saldo: brl(receitas - despesas),
      lancamentosPendentesOuAtrasados: pendencias,
    },
    estoque: {
      produtosComEstoqueBaixo: baixos.length,
      produtosZerados: zerados.length,
      exemplosBaixo: baixos.slice(0, 8).map(nomeProduto),
    },
    clientes: { total: clientes },
  };
}

export const insightsDashboard = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return ResponseHandler(res, parsed.error.issues[0].message, null, 400);
    }

    const mes = getThisMonth();
    const inicio = parsed.data.inicio ? new Date(parsed.data.inicio) : mes.start;
    const fim = parsed.data.fim ? new Date(parsed.data.fim) : mes.end;
    if (isNaN(inicio.getTime()) || isNaN(fim.getTime())) {
      return ResponseHandler(res, "Período inválido", null, 400);
    }

    const kpis = await montarKpis(contaId, inicio, fim);

    const prompt = [
      "KPIs do negócio no período (em JSON):",
      JSON.stringify(kpis, null, 2),
      "",
      "Analise esses números e escreva um panorama para o dono do negócio.",
    ].join("\n");

    const systemInstruction = [
      "Você é um analista de negócios de um ERP para pequenas empresas brasileiras.",
      "Responda em português do Brasil, em Markdown, de forma objetiva e prática, usando estas seções:",
      "## Resumo (2-3 frases sobre o período)",
      "## Destaques (bullets com os pontos positivos e de atenção)",
      "## Recomendações (bullets com ações concretas)",
      "Baseie-se apenas nos números fornecidos; não invente dados. Seja direto e evite jargão.",
    ].join("\n");

    const { text, usage } = await generateText({
      contaId,
      feature: "insights_dashboard",
      prompt,
      systemInstruction,
    });

    return ResponseHandler(res, "Sucesso", { text: text.trim(), kpis, usage });
  } catch (err) {
    handleIaError(res, err);
  }
};
