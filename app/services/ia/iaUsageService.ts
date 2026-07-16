import { prisma } from "../../utils/prisma";
import { iaPlatformService } from "./iaPlatformService";

// Medição e limite mensal de consumo de tokens de IA por conta.
// A quota é resolvida assim: override da conta (ParametrosConta.iaLimiteTokensMensal) tem
// prioridade; senão o padrão global do CEO (IaCoreConfig.limiteTokensMensalPadrao); se ambos
// forem null, o uso é ilimitado.

// NOTE: `prisma as any` é usado para o model/colunas novos (IaUso, limiteTokensMensalPadrao,
// iaLimiteTokensMensal) enquanto o Prisma Client não é regenerado no ambiente de dev.
const db = prisma as any;

export class IaQuotaExcededError extends Error {
  constructor(message = "Limite mensal de uso de IA do plano atingido.") {
    super(message);
    this.name = "IaQuotaExcededError";
  }
}

export interface UsageInput {
  contaId: number;
  feature: string;
  provider?: string;
  modelId: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

export const iaUsageService = {
  // Registra o consumo de uma chamada. Nunca lança (falha de medição não deve quebrar a feature).
  async recordUsage(input: UsageInput): Promise<void> {
    try {
      const prompt = Math.max(0, Math.round(input.promptTokens || 0));
      const completion = Math.max(0, Math.round(input.completionTokens || 0));
      const total = Math.max(0, Math.round(input.totalTokens || prompt + completion));
      await db.iaUso.create({
        data: {
          contaId: input.contaId,
          feature: input.feature,
          provider: input.provider || "gemini",
          modelId: input.modelId,
          promptTokens: prompt,
          completionTokens: completion,
          totalTokens: total,
        },
      });
    } catch (err) {
      console.warn("Falha ao registrar consumo de IA:", err);
    }
  },

  // Tokens consumidos pela conta no mês corrente.
  async getMonthlyUsage(contaId: number): Promise<number> {
    const agg = await db.iaUso.aggregate({
      _sum: { totalTokens: true },
      where: { contaId, createdAt: { gte: startOfCurrentMonth() } },
    });
    return agg?._sum?.totalTokens || 0;
  },

  // Limite mensal efetivo (null = ilimitado).
  async getEffectiveLimit(contaId: number): Promise<number | null> {
    const [parametros, coreCfg] = await Promise.all([
      prisma.parametrosConta.findFirst({ where: { contaId } }),
      iaPlatformService.getCoreConfigRow(),
    ]);
    const override = (parametros as any)?.iaLimiteTokensMensal;
    if (typeof override === "number") return override;
    const padrao = (coreCfg as any)?.limiteTokensMensalPadrao;
    return typeof padrao === "number" ? padrao : null;
  },

  // Resumo do mês para uma conta (uso + limite efetivo).
  async getContaMonthlySummary(contaId: number) {
    const [usado, limite] = await Promise.all([
      this.getMonthlyUsage(contaId),
      this.getEffectiveLimit(contaId),
    ]);
    return { totalTokens: usado, limite, restante: limite == null ? null : Math.max(0, limite - usado) };
  },

  // Resumo do mês para toda a plataforma (para o painel do CEO).
  async getPlatformMonthlySummary() {
    const start = startOfCurrentMonth();
    const [totalAgg, porFeature] = await Promise.all([
      db.iaUso.aggregate({
        _sum: { totalTokens: true },
        _count: { _all: true },
        where: { createdAt: { gte: start } },
      }),
      db.iaUso.groupBy({
        by: ["feature"],
        _sum: { totalTokens: true },
        where: { createdAt: { gte: start } },
      }),
    ]);
    return {
      mesInicio: start,
      totalTokens: totalAgg?._sum?.totalTokens || 0,
      chamadas: totalAgg?._count?._all || 0,
      porFeature: (porFeature || [])
        .map((f: any) => ({ feature: f.feature, tokens: f._sum?.totalTokens || 0 }))
        .sort((a: any, b: any) => b.tokens - a.tokens),
    };
  },

  // Lança IaQuotaExcededError se a conta já atingiu o limite mensal.
  async assertWithinQuota(contaId: number): Promise<void> {
    const limit = await this.getEffectiveLimit(contaId);
    if (limit == null || limit <= 0) return; // sem limite configurado
    const usado = await this.getMonthlyUsage(contaId);
    if (usado >= limit) {
      throw new IaQuotaExcededError();
    }
  },
};
