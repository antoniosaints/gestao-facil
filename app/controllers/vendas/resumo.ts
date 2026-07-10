import { Request, Response } from "express";
import { handleError } from "../../utils/handleError";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { getThisMonth } from "../dashboard/hooks";
import { Prisma } from "../../../generated";
import Decimal from "decimal.js";

export class ResumoVendasController {
  static async getResumo(req: Request, res: Response): Promise<any> {
    try {
      const customData = getCustomRequest(req).customData;
      const { inicio, fim } = req.query;

      const where: Prisma.VendasWhereInput = {
        contaId: customData.contaId,
      };

      if (inicio && fim) {
        where.data = {
          gte: new Date(inicio as string),
          lte: new Date(fim as string),
        };
      } else {
        where.data = {
          gte: getThisMonth().start,
          lte: getThisMonth().end,
        };
      }

      const vendas = await prisma.vendas.findMany({
        where,
        include: {
          PagamentoVendas: true,
        },
      });

      const totalVendas = vendas.length;
      const totalValorVendas = vendas.reduce((total, venda) => {
        return total.add(venda.valor);
      }, new Decimal(0));

      const totalFaturado = vendas.filter((venda) => venda.faturado === true).length;
      const totalValorFaturado = vendas.filter((venda) => venda.faturado === true).reduce((total, venda) => {
        return total.add(venda.valor);
      }, new Decimal(0));

      const totalAberto = vendas.filter((venda) => ["PENDENTE", "FINALIZADO", "ANDAMENTO"].includes(venda.status)).length;
      const totalValorAberto = vendas.filter((venda) => ["PENDENTE", "FINALIZADO", "ANDAMENTO"].includes(venda.status)).reduce((total, venda) => {
        return total.add(venda.valor);
      }, new Decimal(0));

      const totalOrcamento = vendas.filter((venda) => ["ORCAMENTO"].includes(venda.status)).length;
      const totalValorOrcamento = vendas.filter((venda) => ["ORCAMENTO"].includes(venda.status)).reduce((total, venda) => {
        return total.add(venda.valor);
      }, new Decimal(0));

      const totalVendasComDesconto = vendas.filter((venda) => venda.desconto && venda.desconto.gt(0)).length;
      const totalValorDescontos = vendas.reduce((total, venda) => {
        return total.add(venda.desconto || new Decimal(0));
      }, new Decimal(0));

      const ticketMedio = totalValorFaturado.div(totalFaturado || new Decimal(1));

      return res.status(200).json({
        totalVendas,
        totalValorVendas: totalValorVendas.toFixed(2),
        totalFaturado,
        totalValorFaturado: totalValorFaturado.toFixed(2),
        totalAberto,
        totalValorAberto: totalValorAberto.toFixed(2),
        totalOrcamento,
        totalValorOrcamento: totalValorOrcamento.toFixed(2),
        totalVendasComDesconto,
        totalValorDescontos: totalValorDescontos.toFixed(2),
        ticketMedio: ticketMedio.toFixed(2),
      });

    } catch (error) {
      handleError(res, error);
    }
  }

  /**
   * Painel de vendas consolidado: KPIs com comparação ao período anterior,
   * curva de faturamento, quebras por status/pagamento/dia-da-semana/hora
   * e rankings de produtos, clientes e vendedores — tudo em uma requisição.
   */
  static async getPainel(req: Request, res: Response): Promise<any> {
    try {
      const customData = getCustomRequest(req).customData;
      const { inicio, fim } = req.query;

      const start = inicio ? new Date(inicio as string) : getThisMonth().start;
      const end = fim ? new Date(fim as string) : getThisMonth().end;
      const durationMs = Math.max(0, end.getTime() - start.getTime());
      const prevEnd = new Date(start.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - durationMs);

      const [vendas, vendasAnterior, itens] = await Promise.all([
        prisma.vendas.findMany({
          where: { contaId: customData.contaId, data: { gte: start, lte: end } },
          select: {
            valor: true,
            desconto: true,
            data: true,
            status: true,
            faturado: true,
            clienteId: true,
            vendedorId: true,
            cliente: { select: { nome: true } },
            vendedor: { select: { nome: true } },
            PagamentoVendas: { select: { metodo: true, valor: true, status: true } },
          },
        }),
        prisma.vendas.findMany({
          where: {
            contaId: customData.contaId,
            faturado: true,
            data: { gte: prevStart, lte: prevEnd },
          },
          select: { valor: true },
        }),
        prisma.itensVendas.findMany({
          where: {
            venda: {
              contaId: customData.contaId,
              faturado: true,
              data: { gte: start, lte: end },
            },
          },
          select: {
            produtoId: true,
            itemName: true,
            quantidade: true,
            valor: true,
            produto: { select: { nome: true, nomeVariante: true } },
          },
        }),
      ]);

      const num = (value: unknown) => Number(value || 0);
      const pad = (value: number) => String(value).padStart(2, "0");
      const delta = (atual: number, anterior: number) =>
        anterior > 0 ? ((atual - anterior) / anterior) * 100 : atual > 0 ? 100 : 0;

      const faturadas = vendas.filter((venda) => venda.faturado);
      const faturamentoAtual = faturadas.reduce((sum, venda) => sum + num(venda.valor), 0);
      const qtdFaturadas = faturadas.length;
      const ticketAtual = qtdFaturadas ? faturamentoAtual / qtdFaturadas : 0;
      const descontosAtual = vendas.reduce((sum, venda) => sum + num(venda.desconto), 0);

      const faturamentoAnterior = vendasAnterior.reduce((sum, venda) => sum + num(venda.valor), 0);
      const qtdAnterior = vendasAnterior.length;
      const ticketAnterior = qtdAnterior ? faturamentoAnterior / qtdAnterior : 0;

      const emAbertoList = vendas.filter((venda) =>
        ["PENDENTE", "FINALIZADO", "ANDAMENTO"].includes(venda.status)
      );
      const orcamentoList = vendas.filter((venda) => venda.status === "ORCAMENTO");

      // Curva de faturamento: por dia (períodos <= 92 dias) ou por mês.
      const dayMs = 86_400_000;
      const diffDays = Math.max(1, Math.round(durationMs / dayMs) + 1);
      const serieBuckets = new Map<string, number>();
      const usarDia = diffDays <= 92;
      if (usarDia) {
        for (let i = 0; i < diffDays; i++) {
          const dia = new Date(start.getTime() + i * dayMs);
          serieBuckets.set(`${pad(dia.getDate())}/${pad(dia.getMonth() + 1)}`, 0);
        }
      }
      for (const venda of faturadas) {
        const dia = new Date(venda.data);
        const key = usarDia
          ? `${pad(dia.getDate())}/${pad(dia.getMonth() + 1)}`
          : `${pad(dia.getMonth() + 1)}/${dia.getFullYear()}`;
        serieBuckets.set(key, (serieBuckets.get(key) || 0) + num(venda.valor));
      }

      const statusMap = new Map<string, number>();
      for (const venda of vendas) {
        statusMap.set(venda.status, (statusMap.get(venda.status) || 0) + 1);
      }

      const pagamentoMap = new Map<string, number>();
      for (const venda of vendas) {
        const pagamento = venda.PagamentoVendas;
        if (pagamento && pagamento.status === "EFETIVADO") {
          pagamentoMap.set(
            pagamento.metodo,
            (pagamentoMap.get(pagamento.metodo) || 0) + num(pagamento.valor)
          );
        }
      }

      const produtoMap = new Map<string, { nome: string; quantidade: number; valor: number }>();
      for (const item of itens) {
        const nome = item.produto
          ? item.produto.nomeVariante && item.produto.nomeVariante !== "Padrão"
            ? `${item.produto.nome} / ${item.produto.nomeVariante}`
            : item.produto.nome
          : item.itemName || "Desconhecido";
        const key = item.produtoId ? `p:${item.produtoId}` : `n:${nome}`;
        const atual = produtoMap.get(key) || { nome, quantidade: 0, valor: 0 };
        atual.quantidade += num(item.quantidade);
        atual.valor += num(item.valor) * num(item.quantidade);
        produtoMap.set(key, atual);
      }
      const topProdutos = [...produtoMap.values()]
        .sort((a, b) => b.valor - a.valor)
        .slice(0, 8);

      const clienteMap = new Map<string, { nome: string; valor: number; qtd: number }>();
      for (const venda of faturadas) {
        const nome = venda.cliente?.nome || "Sem cliente";
        const key = venda.clienteId ? `c:${venda.clienteId}` : "sem";
        const atual = clienteMap.get(key) || { nome, valor: 0, qtd: 0 };
        atual.valor += num(venda.valor);
        atual.qtd += 1;
        clienteMap.set(key, atual);
      }
      const topClientes = [...clienteMap.values()]
        .sort((a, b) => b.valor - a.valor)
        .slice(0, 6);

      const vendedorMap = new Map<string, { nome: string; valor: number; qtd: number }>();
      for (const venda of faturadas) {
        if (!venda.vendedorId) continue;
        const nome = venda.vendedor?.nome || "Vendedor";
        const key = `v:${venda.vendedorId}`;
        const atual = vendedorMap.get(key) || { nome, valor: 0, qtd: 0 };
        atual.valor += num(venda.valor);
        atual.qtd += 1;
        vendedorMap.set(key, atual);
      }
      const topVendedores = [...vendedorMap.values()]
        .sort((a, b) => b.valor - a.valor)
        .slice(0, 6);

      const diasSemana = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
      const semanaData = [0, 0, 0, 0, 0, 0, 0];
      for (const venda of faturadas) {
        semanaData[new Date(venda.data).getDay()] += num(venda.valor);
      }

      const horaData = Array.from({ length: 24 }, () => 0);
      for (const venda of faturadas) {
        horaData[new Date(venda.data).getHours()] += num(venda.valor);
      }

      return res.status(200).json({
        periodo: {
          inicio: start,
          fim: end,
          anterior: { inicio: prevStart, fim: prevEnd },
        },
        kpis: {
          faturamento: {
            atual: faturamentoAtual,
            anterior: faturamentoAnterior,
            delta: delta(faturamentoAtual, faturamentoAnterior),
          },
          vendas: {
            atual: qtdFaturadas,
            anterior: qtdAnterior,
            delta: delta(qtdFaturadas, qtdAnterior),
          },
          ticketMedio: {
            atual: ticketAtual,
            anterior: ticketAnterior,
            delta: delta(ticketAtual, ticketAnterior),
          },
          descontos: { atual: descontosAtual },
          emAberto: {
            valor: emAbertoList.reduce((sum, venda) => sum + num(venda.valor), 0),
            qtd: emAbertoList.length,
          },
          orcamento: {
            valor: orcamentoList.reduce((sum, venda) => sum + num(venda.valor), 0),
            qtd: orcamentoList.length,
          },
          totalVendas: vendas.length,
        },
        serieDiaria: {
          labels: [...serieBuckets.keys()],
          data: [...serieBuckets.values()],
        },
        porStatus: { labels: [...statusMap.keys()], data: [...statusMap.values()] },
        porPagamento: { labels: [...pagamentoMap.keys()], data: [...pagamentoMap.values()] },
        porDiaSemana: { labels: diasSemana, data: semanaData },
        porHora: {
          labels: Array.from({ length: 24 }, (_, i) => `${pad(i)}h`),
          data: horaData,
        },
        topProdutos,
        topClientes,
        topVendedores,
      });
    } catch (error) {
      handleError(res, error);
    }
  }
}
