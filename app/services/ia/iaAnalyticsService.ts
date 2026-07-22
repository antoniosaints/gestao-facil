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
