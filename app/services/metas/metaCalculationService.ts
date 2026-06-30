import Decimal from "decimal.js";
import type { PrismaClient } from "../../../generated/client";
import type { prisma as prismaSingleton } from "../../utils/prisma";
import {
  calculateMetaProgress,
  getMetaHistoryWindows,
  getMetaPeriodWindow,
  type MetricaMeta,
  type PeriodicidadeMeta,
  type TipoMeta,
} from "./metaPolicy";

type DbClient = PrismaClient | typeof prismaSingleton;

export type MetaLike = {
  id: number;
  contaId: number;
  nome: string;
  descricao?: string | null;
  tipo: TipoMeta;
  metrica: MetricaMeta;
  periodicidade: PeriodicidadeMeta;
  valorAlvo: Decimal.Value;
  dataInicio: Date;
  dataFim?: Date | null;
  financeiroTipo?: "RECEITA" | "DESPESA" | null;
  ativo: boolean;
};

export async function buildMetaResumo(db: DbClient, meta: MetaLike, referenceDate = new Date()) {
  const periodoAtual = getMetaPeriodWindow(meta, referenceDate);
  const valorAtual = await calcularValorMeta(db, meta, periodoAtual.inicio, periodoAtual.fim);
  const progresso = calculateMetaProgress({ valorAtual, valorAlvo: meta.valorAlvo });
  const historico = await Promise.all(
    getMetaHistoryWindows(meta, referenceDate, 12).map(async (periodo) => {
      const valorPeriodo = await calcularValorMeta(db, meta, periodo.inicio, periodo.fim);
      const progressoPeriodo = calculateMetaProgress({ valorAtual: valorPeriodo, valorAlvo: meta.valorAlvo });

      return {
        label: periodo.label,
        inicio: periodo.inicio,
        fim: periodo.fim,
        valorAtual: valorPeriodo.toNumber(),
        percentual: progressoPeriodo.percentual,
        atingida: progressoPeriodo.atingida,
      };
    }),
  );

  return {
    id: meta.id,
    nome: meta.nome,
    descricao: meta.descricao,
    tipo: meta.tipo,
    metrica: meta.metrica,
    periodicidade: meta.periodicidade,
    financeiroTipo: meta.financeiroTipo,
    ativo: meta.ativo,
    valorAlvo: new Decimal(meta.valorAlvo || 0).toNumber(),
    periodoAtual: {
      label: periodoAtual.label,
      inicio: periodoAtual.inicio,
      fim: periodoAtual.fim,
    },
    valorAtual: progresso.valorAtual.toNumber(),
    percentual: progresso.percentual,
    atingida: progresso.atingida,
    restante: progresso.restante.toNumber(),
    historico,
  };
}

async function calcularValorMeta(db: DbClient, meta: MetaLike, inicio: Date, fim: Date) {
  if (meta.tipo === "VENDAS") {
    return calcularMetaVendas(db, meta, inicio, fim);
  }

  if (meta.tipo === "SERVICOS") {
    return calcularMetaServicos(db, meta, inicio, fim);
  }

  return calcularMetaFinanceiro(db, meta, inicio, fim);
}

async function calcularMetaVendas(db: DbClient, meta: MetaLike, inicio: Date, fim: Date) {
  const where = {
    contaId: meta.contaId,
    status: { in: ["FATURADO", "FINALIZADO"] as const },
    data: { gte: inicio, lte: fim },
  };

  if (meta.metrica === "QUANTIDADE") {
    return new Decimal(await db.vendas.count({ where }));
  }

  const vendas = await db.vendas.findMany({
    where,
    select: { valor: true },
  });

  return vendas.reduce((acc, venda) => acc.plus(venda.valor), new Decimal(0));
}

async function calcularMetaServicos(db: DbClient, meta: MetaLike, inicio: Date, fim: Date) {
  const where = {
    contaId: meta.contaId,
    status: "FATURADA" as const,
    data: { gte: inicio, lte: fim },
  };

  if (meta.metrica === "QUANTIDADE") {
    return new Decimal(await db.ordensServico.count({ where }));
  }

  const ordens = await db.ordensServico.findMany({
    where,
    select: {
      desconto: true,
      ItensOrdensServico: {
        select: {
          valor: true,
          quantidade: true,
        },
      },
    },
  });

  return ordens.reduce((total, ordem) => {
    const subtotal = ordem.ItensOrdensServico.reduce(
      (acc, item) => acc.plus(new Decimal(item.valor).times(item.quantidade)),
      new Decimal(0),
    );
    return total.plus(Decimal.max(subtotal.minus(ordem.desconto || 0), 0));
  }, new Decimal(0));
}

async function calcularMetaFinanceiro(db: DbClient, meta: MetaLike, inicio: Date, fim: Date) {
  const tipo = meta.financeiroTipo || "RECEITA";
  const where = {
    pago: true,
    dataPagamento: { gte: inicio, lte: fim },
    lancamento: {
      contaId: meta.contaId,
      tipo,
    },
  };

  if (meta.metrica === "QUANTIDADE") {
    return new Decimal(await db.parcelaFinanceiro.count({ where }));
  }

  const parcelas = await db.parcelaFinanceiro.findMany({
    where,
    select: {
      valor: true,
      valorPago: true,
    },
  });

  return parcelas.reduce((acc, parcela) => acc.plus(parcela.valorPago ?? parcela.valor), new Decimal(0));
}
