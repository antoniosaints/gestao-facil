import type { Prisma } from "../../../generated";
import { parcelaDeContaContabilizada } from "../financeiro/contaFinanceiraCalculosPolicy";
import { prisma } from "../../utils/prisma";

const num = (d: any) => Number(d ?? 0);
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/// Monta um JSON compacto de KPIs do período (vendas, financeiro, estoque, clientes).
/// Usado tanto pelo endpoint de insights do dashboard quanto pela ferramenta de chat
/// do Core IA — os números chegam prontos para o modelo não precisar calcular.
/// Reaproveita os mesmos critérios do dashboard (vendas efetivadas).
export async function montarKpisNegocio(contaId: number, inicio: Date, fim: Date) {
  const duracao = fim.getTime() - inicio.getTime();
  const prevFim = new Date(inicio.getTime() - 1);
  const prevInicio = new Date(prevFim.getTime() - duracao);
  const statusVendaEfetiva = ["FATURADO", "FINALIZADO"] as const;

  const periodoFinanceiro: Prisma.LancamentoFinanceiroWhereInput = {
    contaId,
    ignorado: false,
    dataLancamento: { gte: inicio, lte: fim },
  };
  const parcelasConsideradas = { ignorado: false, ...parcelaDeContaContabilizada };
  const sumarizar = (tipo: "RECEITA" | "DESPESA") =>
    prisma.parcelaFinanceiro.aggregate({
      _sum: { valor: true },
      where: { ...parcelasConsideradas, lancamento: { ...periodoFinanceiro, tipo } },
    });

  const [vendasAtual, vendasAnterior, receitasTotal, despesasTotal, pendencias, produtos, clientes] =
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
      sumarizar("RECEITA"),
      sumarizar("DESPESA"),
      prisma.lancamentoFinanceiro.count({
        where: {
          ...periodoFinanceiro,
          status: { in: ["PENDENTE", "ATRASADO"] },
          parcelas: { some: { ...parcelasConsideradas, pago: false } },
        },
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

  const receitas = num(receitasTotal._sum.valor);
  const despesas = num(despesasTotal._sum.valor);

  const baixos = produtos.filter((p) => Number(p.estoque) > 0 && Number(p.estoque) <= Number(p.minimo));
  const zerados = produtos.filter((p) => Number(p.estoque) <= 0);
  const nomeProduto = (p: any) => [p.nome, p.nomeVariante].filter(Boolean).join(" ");

  return {
    periodo: { inicio: inicio.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) },
    periodoAnterior: {
      inicio: prevInicio.toISOString().slice(0, 10),
      fim: prevFim.toISOString().slice(0, 10),
    },
    vendas: {
      total: brl(totalVendas),
      quantidade: qtdVendas,
      ticketMedio: brl(qtdVendas > 0 ? totalVendas / qtdVendas : 0),
      totalPeriodoAnterior: brl(totalVendasAnt),
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
