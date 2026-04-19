import { Request, Response } from "express";
import { eachDayOfInterval, eachMonthOfInterval, endOfMonth, format, isWithinInterval, startOfDay, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { buildParcelaFinanceiroWhere, decimalToNumber, getParcelaStatus, parseFinanceiroFilters } from "./queryFilters";

type ParcelaAnalytics = {
  id: number;
  valor: number;
  pago: boolean;
  vencimento: Date;
  dataPagamento: Date | null;
  contaFinanceira: number | null;
  formaPagamento: string | null;
  lancamento: {
    id: number;
    Uid: string;
    descricao: string;
    tipo: "RECEITA" | "DESPESA";
    categoria: { id: number; nome: string };
    cliente: { id: number; nome: string } | null;
  };
};

const toSignedValue = (tipo: "RECEITA" | "DESPESA", value: number) =>
  tipo === "RECEITA" ? value : -value;

const isBetween = (date: Date | null | undefined, inicio: Date, fim: Date) => {
  if (!date) return false;
  return isWithinInterval(date, { start: inicio, end: fim });
};

export const getDashboardFinanceiroVisaoGeral = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const filters = parseFinanceiroFilters(req, { defaultRange: "current-month" });

    if (!filters.inicio || !filters.fim) {
      return res.status(400).json({ message: "Informe um período válido." });
    }

    const [contasFinanceiras, parcelasBrutas] = await Promise.all([
      prisma.contasFinanceiro.findMany({
        where: {
          contaId,
          ...(filters.contaFinanceiraId ? { id: filters.contaFinanceiraId } : {}),
        },
        select: {
          id: true,
          nome: true,
          saldoInicial: true,
        },
        orderBy: { nome: "asc" },
      }),
      prisma.parcelaFinanceiro.findMany({
        where: buildParcelaFinanceiroWhere(contaId, filters),
        select: {
          id: true,
          valor: true,
          pago: true,
          vencimento: true,
          dataPagamento: true,
          contaFinanceira: true,
          formaPagamento: true,
          lancamento: {
            select: {
              id: true,
              Uid: true,
              descricao: true,
              tipo: true,
              categoria: {
                select: {
                  id: true,
                  nome: true,
                },
              },
              cliente: {
                select: {
                  id: true,
                  nome: true,
                },
              },
            },
          },
        },
        orderBy: [{ vencimento: "asc" }, { id: "asc" }],
      }),
    ]);

    const hoje = startOfDay(new Date());
    const saldoInicialTotal = contasFinanceiras.reduce((acc, conta) => acc + decimalToNumber(conta.saldoInicial), 0);

    const parcelas = parcelasBrutas.map((parcela) => ({
      id: parcela.id,
      valor: decimalToNumber(parcela.valor),
      pago: parcela.pago,
      vencimento: parcela.vencimento,
      dataPagamento: parcela.dataPagamento,
      contaFinanceira: parcela.contaFinanceira,
      formaPagamento: parcela.formaPagamento,
      lancamento: {
        id: parcela.lancamento.id,
        Uid: parcela.lancamento.Uid,
        descricao: parcela.lancamento.descricao,
        tipo: parcela.lancamento.tipo,
        categoria: {
          id: parcela.lancamento.categoria.id,
          nome: parcela.lancamento.categoria.nome,
        },
        cliente: parcela.lancamento.cliente,
      },
    })) as ParcelaAnalytics[];

    const saldoRealizadoAtual = saldoInicialTotal + parcelas
      .filter((parcela) => parcela.pago && parcela.dataPagamento && parcela.dataPagamento <= hoje)
      .reduce((acc, parcela) => acc + toSignedValue(parcela.lancamento.tipo, parcela.valor), 0);

    const saldoPrevistoPeriodo = saldoInicialTotal + parcelas
      .filter((parcela) => parcela.vencimento <= filters.fim!)
      .reduce((acc, parcela) => acc + toSignedValue(parcela.lancamento.tipo, parcela.valor), 0);

    const receitasRealizadasPeriodo = parcelas
      .filter((parcela) => parcela.lancamento.tipo === "RECEITA" && parcela.pago && isBetween(parcela.dataPagamento, filters.inicio!, filters.fim!))
      .reduce((acc, parcela) => acc + parcela.valor, 0);

    const despesasRealizadasPeriodo = parcelas
      .filter((parcela) => parcela.lancamento.tipo === "DESPESA" && parcela.pago && isBetween(parcela.dataPagamento, filters.inicio!, filters.fim!))
      .reduce((acc, parcela) => acc + parcela.valor, 0);

    const receitasPrevistasPeriodo = parcelas
      .filter((parcela) => parcela.lancamento.tipo === "RECEITA" && isBetween(parcela.vencimento, filters.inicio!, filters.fim!))
      .reduce((acc, parcela) => acc + parcela.valor, 0);

    const despesasPrevistasPeriodo = parcelas
      .filter((parcela) => parcela.lancamento.tipo === "DESPESA" && isBetween(parcela.vencimento, filters.inicio!, filters.fim!))
      .reduce((acc, parcela) => acc + parcela.valor, 0);

    const aReceberPendente = parcelas
      .filter((parcela) => parcela.lancamento.tipo === "RECEITA" && !parcela.pago && isBetween(parcela.vencimento, filters.inicio!, filters.fim!))
      .reduce((acc, parcela) => acc + parcela.valor, 0);

    const aPagarPendente = parcelas
      .filter((parcela) => parcela.lancamento.tipo === "DESPESA" && !parcela.pago && isBetween(parcela.vencimento, filters.inicio!, filters.fim!))
      .reduce((acc, parcela) => acc + parcela.valor, 0);

    const atrasadoReceber = parcelas
      .filter((parcela) => parcela.lancamento.tipo === "RECEITA" && getParcelaStatus(parcela, hoje) === "ATRASADO")
      .reduce((acc, parcela) => acc + parcela.valor, 0);

    const atrasadoPagar = parcelas
      .filter((parcela) => parcela.lancamento.tipo === "DESPESA" && getParcelaStatus(parcela, hoje) === "ATRASADO")
      .reduce((acc, parcela) => acc + parcela.valor, 0);

    const saldoRealizadoInicial = saldoInicialTotal + parcelas
      .filter((parcela) => parcela.pago && parcela.dataPagamento && parcela.dataPagamento < filters.inicio!)
      .reduce((acc, parcela) => acc + toSignedValue(parcela.lancamento.tipo, parcela.valor), 0);

    const saldoPrevistoInicial = saldoInicialTotal + parcelas
      .filter((parcela) => parcela.vencimento < filters.inicio!)
      .reduce((acc, parcela) => acc + toSignedValue(parcela.lancamento.tipo, parcela.valor), 0);

    const fluxoBuckets = (() => {
      const totalDias = Math.ceil((filters.fim!.getTime() - filters.inicio!.getTime()) / (1000 * 60 * 60 * 24));
      const mode = totalDias <= 45 ? "day" : "month";
      const starts = mode === "day"
        ? eachDayOfInterval({ start: filters.inicio!, end: filters.fim! })
        : eachMonthOfInterval({ start: filters.inicio!, end: filters.fim! });

      let saldoRealizadoAcumulado = saldoRealizadoInicial;
      let saldoPrevistoAcumulado = saldoPrevistoInicial;

      const labels: string[] = [];
      const saldoRealizado: number[] = [];
      const saldoPrevisto: number[] = [];

      starts.forEach((bucketStart) => {
        const bucketEnd = mode === "day"
          ? new Date(new Date(bucketStart).setHours(23, 59, 59, 999))
          : endOfMonth(bucketStart);

        labels.push(format(bucketStart, mode === "day" ? "dd/MM" : "MMM/yyyy", { locale: ptBR }));

        const realizadoLiquido = parcelas
          .filter((parcela) => parcela.pago && isBetween(parcela.dataPagamento, bucketStart, bucketEnd))
          .reduce((acc, parcela) => acc + toSignedValue(parcela.lancamento.tipo, parcela.valor), 0);

        const previstoLiquido = parcelas
          .filter((parcela) => isBetween(parcela.vencimento, bucketStart, bucketEnd))
          .reduce((acc, parcela) => acc + toSignedValue(parcela.lancamento.tipo, parcela.valor), 0);

        saldoRealizadoAcumulado += realizadoLiquido;
        saldoPrevistoAcumulado += previstoLiquido;

        saldoRealizado.push(saldoRealizadoAcumulado);
        saldoPrevisto.push(saldoPrevistoAcumulado);
      });

      return {
        labels,
        datasets: [
          {
            label: "Saldo realizado acumulado",
            data: saldoRealizado,
            borderColor: "#2563eb",
            backgroundColor: "rgba(37, 99, 235, 0.12)",
            fill: true,
            tension: 0.3,
          },
          {
            label: "Saldo previsto acumulado",
            data: saldoPrevisto,
            borderColor: "#10b981",
            backgroundColor: "rgba(16, 185, 129, 0.08)",
            fill: false,
            tension: 0.3,
            borderDash: [6, 6],
          },
        ],
      };
    })();

    const categoriasPeriodoMap = new Map<string, { receita: number; despesa: number }>();
    parcelas
      .filter((parcela) => isBetween(parcela.vencimento, filters.inicio!, filters.fim!))
      .forEach((parcela) => {
        const key = parcela.lancamento.categoria.nome;
        const current = categoriasPeriodoMap.get(key) ?? { receita: 0, despesa: 0 };

        if (parcela.lancamento.tipo === "RECEITA") {
          current.receita += parcela.valor;
        } else {
          current.despesa += parcela.valor;
        }

        categoriasPeriodoMap.set(key, current);
      });

    const categoriasOrdenadas = Array.from(categoriasPeriodoMap.entries())
      .sort((a, b) => (b[1].receita + b[1].despesa) - (a[1].receita + a[1].despesa))
      .slice(0, 8);

    const categoriasChart = {
      labels: categoriasOrdenadas.map(([label]) => label),
      datasets: [
        {
          label: "Receitas previstas",
          backgroundColor: "#10b981",
          data: categoriasOrdenadas.map(([, values]) => values.receita),
        },
        {
          label: "Despesas previstas",
          backgroundColor: "#ef4444",
          data: categoriasOrdenadas.map(([, values]) => values.despesa),
        },
      ],
    };

    const statusChart = {
      labels: ["Recebido", "Pago", "A receber", "A pagar", "Atrasado receber", "Atrasado pagar"],
      datasets: [
        {
          label: "Valor",
          backgroundColor: ["#16a34a", "#dc2626", "#22c55e", "#f97316", "#eab308", "#ef4444"],
          data: [
            receitasRealizadasPeriodo,
            despesasRealizadasPeriodo,
            aReceberPendente,
            aPagarPendente,
            atrasadoReceber,
            atrasadoPagar,
          ],
        },
      ],
    };

    const contasResumo = contasFinanceiras.map((conta) => {
      const saldoInicialConta = decimalToNumber(conta.saldoInicial);
      const parcelasConta = parcelas.filter((parcela) => parcela.contaFinanceira === conta.id);

      const saldoAtual = saldoInicialConta + parcelasConta
        .filter((parcela) => parcela.pago && parcela.dataPagamento && parcela.dataPagamento <= hoje)
        .reduce((acc, parcela) => acc + toSignedValue(parcela.lancamento.tipo, parcela.valor), 0);

      const saldoPrevisto = saldoInicialConta + parcelasConta
        .filter((parcela) => parcela.vencimento <= filters.fim!)
        .reduce((acc, parcela) => acc + toSignedValue(parcela.lancamento.tipo, parcela.valor), 0);

      const pendenteReceber = parcelasConta
        .filter((parcela) => parcela.lancamento.tipo === "RECEITA" && !parcela.pago && isBetween(parcela.vencimento, filters.inicio!, filters.fim!))
        .reduce((acc, parcela) => acc + parcela.valor, 0);

      const pendentePagar = parcelasConta
        .filter((parcela) => parcela.lancamento.tipo === "DESPESA" && !parcela.pago && isBetween(parcela.vencimento, filters.inicio!, filters.fim!))
        .reduce((acc, parcela) => acc + parcela.valor, 0);

      return {
        contaId: conta.id,
        conta: conta.nome,
        saldoInicial: saldoInicialConta,
        saldoAtual,
        saldoPrevisto,
        pendenteReceber,
        pendentePagar,
      };
    });

    return res.json({
      data: {
        periodo: {
          inicio: filters.inicio,
          fim: filters.fim,
        },
        filtros: {
          contaFinanceiraId: filters.contaFinanceiraId ?? null,
          categoriaId: filters.categoriaId ?? null,
          clienteId: filters.clienteId ?? null,
          tipo: filters.tipo,
          search: filters.search ?? "",
        },
        cards: {
          saldoAtual: saldoRealizadoAtual,
          saldoPrevisto: saldoPrevistoPeriodo,
          receitasRealizadas: receitasRealizadasPeriodo,
          despesasRealizadas: despesasRealizadasPeriodo,
          receitasPrevistas: receitasPrevistasPeriodo,
          despesasPrevistas: despesasPrevistasPeriodo,
          aReceberPendente,
          aPagarPendente,
          atrasadoReceber,
          atrasadoPagar,
        },
        graficos: {
          fluxo: fluxoBuckets,
          categorias: categoriasChart,
          status: statusChart,
        },
        contas: contasResumo,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erro ao carregar o dashboard financeiro." });
  }
};
