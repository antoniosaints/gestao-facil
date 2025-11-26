import { Prisma } from "@prisma/client";
import { prisma } from "../../utils/prisma";

function toNumber(d: Prisma.Decimal | null | undefined) {
  if (d == null) return 0;
  return parseFloat(String(d));
}

export class ReservasChartsService {
  async receitaPorQuadra(contaId: number) {
    const grouped = await prisma.arenaAgendamentos.groupBy({
      by: ["quadraId"],
      _sum: { valor: true },
    });

    const quadraIds = grouped.map(g => g.quadraId);
    const quadras = await prisma.arenaQuadras.findMany({
      where: { id: { in: quadraIds }, contaId },
    });

    // map id -> nome
    const nomes = new Map(quadras.map(q => [q.id, q.name]));

    const labels = grouped.map(g => nomes.get(g.quadraId) ?? `Quadra ${g.quadraId}`);
    const data = grouped.map(g => toNumber(g._sum.valor));

    return {
      labels,
      datasets: [{ label: "Receita por Quadra", data }],
    };
  }

  async reservasPorQuadra(contaId: number, inicio: Date, fim: Date) {
    const grouped = await prisma.arenaAgendamentos.groupBy({
      by: ["quadraId"],
      _count: { id: true },
      where: {
        Quadra: { contaId },
        startAt: { gte: inicio },
        endAt: { lte: fim },
      },
    });

    const quadraIds = grouped.map(g => g.quadraId);
    const quadras = await prisma.arenaQuadras.findMany({
      where: { id: { in: quadraIds } },
    });
    const nomes = new Map(quadras.map(q => [q.id, q.name]));

    const labels = grouped.map(g => nomes.get(g.quadraId) ?? `Quadra ${g.quadraId}`);
    const data = grouped.map(g => g._count.id);

    return {
      labels,
      datasets: [{ label: `Reservas (${inicio.toISOString().slice(0,10)} → ${fim.toISOString().slice(0,10)})`, data }],
    };
  }

  // ocupação percentual baseado no número de reservas / capacidade estimada
  // "capacidadePorDia" pode ser ajustada conforme seu horário/tempoMinimo
  async ocupacaoPercentual(contaId: number, inicio: Date, fim: Date, capacidadePorDia = 12) {
    const reservas = await prisma.arenaAgendamentos.findMany({
      where: {
        Quadra: { contaId },
        startAt: { gte: inicio },
        endAt: { lte: fim },
        status: { not: "CANCELADA" },
      },
      include: { Quadra: true },
    });

    const totalDias = Math.ceil((+fim - +inicio) / (1000 * 60 * 60 * 24)) + 1;
    const ocupacaoMap = new Map<string, number>();

    reservas.forEach(r => {
      const nome = r.Quadra.name;
      ocupacaoMap.set(nome, (ocupacaoMap.get(nome) ?? 0) + 1);
    });

    const labels = Array.from(ocupacaoMap.keys());
    const raw = Array.from(ocupacaoMap.values());
    // percentual = (reservas) / (capacidadePorDia * totalDias) * 100
    const data = raw.map(v => +( (v / (capacidadePorDia * totalDias)) * 100 ).toFixed(2));

    return {
      labels,
      datasets: [{ label: `Ocupação % (${inicio.toISOString().slice(0,10)} → ${fim.toISOString().slice(0,10)})`, data }],
    };
  }

  // receita mensal para um ano — agrupa no servidor (mais portátil)
  async receitaMensal(contaId: number, ano: number) {
    const inicio = new Date(Date.UTC(ano, 0, 1));
    const fim = new Date(Date.UTC(ano, 11, 31, 23, 59, 59));

    const reservas = await prisma.arenaAgendamentos.findMany({
      where: {
        Quadra: { contaId },
        startAt: { gte: inicio, lte: fim },
      },
      select: {
        startAt: true,
        valor: true,
      },
    });

    const meses = Array.from({ length: 12 }).map(() => 0);
    reservas.forEach(r => {
      const m = new Date(r.startAt).getUTCMonth(); // 0-11
      meses[m] += toNumber(r.valor);
    });

    const labels = meses.map((_, i) => `Mês ${i + 1}`);
    const data = meses.map(v => +v.toFixed(2));

    return {
      labels,
      datasets: [{ label: `Receita Mensal ${ano}`, data, backgroundColor: "#0aa375" }],
    };
  }
}
