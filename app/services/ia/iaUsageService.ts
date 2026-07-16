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

  // Custo estimado (na moeda do CEO) a partir de grupos [modelId -> prompt/completion tokens].
  async estimateCost(
    grupos: Array<{ modelId: string; promptTokens: number; completionTokens: number }>
  ): Promise<number> {
    const costMap = await iaPlatformService.getModelCostMap();
    let custo = 0;
    for (const g of grupos) {
      const c = costMap.get(g.modelId) || { input: 0, output: 0 };
      custo += (g.promptTokens / 1_000_000) * c.input + (g.completionTokens / 1_000_000) * c.output;
    }
    return Number(custo.toFixed(4));
  },

  // Resumo do mês para uma conta (uso + limite efetivo + custo estimado).
  async getContaMonthlySummary(contaId: number) {
    const start = startOfCurrentMonth();
    const [usado, limite, porModelo] = await Promise.all([
      this.getMonthlyUsage(contaId),
      this.getEffectiveLimit(contaId),
      db.iaUso.groupBy({
        by: ["modelId"],
        _sum: { promptTokens: true, completionTokens: true },
        where: { contaId, createdAt: { gte: start } },
      }),
    ]);
    const custoEstimado = await this.estimateCost(
      (porModelo || []).map((m: any) => ({
        modelId: m.modelId,
        promptTokens: m._sum?.promptTokens || 0,
        completionTokens: m._sum?.completionTokens || 0,
      }))
    );
    return {
      totalTokens: usado,
      limite,
      restante: limite == null ? null : Math.max(0, limite - usado),
      custoEstimado,
    };
  },

  // Resumo para o painel de Consumo do CEO. Aceita filtro de período (inicio/fim) e de assinante
  // (contaId). Traz totais, quebra por modelo, por função (feature) e por assinante (conta), além
  // da lista de assinantes que usaram IA no período (para o seletor do filtro).
  async getPlatformMonthlySummary(
    opts: { inicio?: Date | null; fim?: Date | null; contaId?: number | null } = {}
  ) {
    const start = opts.inicio ?? startOfCurrentMonth();
    const end = opts.fim ?? null;
    const createdAt = { gte: start, ...(end ? { lte: end } : {}) };
    // Período (todos os assinantes) e escopo (aplica o filtro de assinante, se houver).
    const wherePeriodo: any = { createdAt };
    const whereScoped: any = { ...wherePeriodo, ...(opts.contaId ? { contaId: opts.contaId } : {}) };

    const [totalAgg, porModeloRaw, porFeatureModelRaw, porContaModelRaw, assinantesRaw] = await Promise.all([
      db.iaUso.aggregate({
        _sum: { totalTokens: true, promptTokens: true, completionTokens: true },
        _count: { _all: true },
        where: whereScoped,
      }),
      db.iaUso.groupBy({
        by: ["modelId"],
        _sum: { promptTokens: true, completionTokens: true, totalTokens: true },
        _count: { _all: true },
        where: whereScoped,
      }),
      // Custo por função depende do modelo usado — agrupa por (feature, modelId).
      db.iaUso.groupBy({
        by: ["feature", "modelId"],
        _sum: { promptTokens: true, completionTokens: true, totalTokens: true },
        _count: { _all: true },
        where: whereScoped,
      }),
      // Custo por assinante depende do modelo usado — agrupa por (contaId, modelId).
      db.iaUso.groupBy({
        by: ["contaId", "modelId"],
        _sum: { promptTokens: true, completionTokens: true, totalTokens: true },
        _count: { _all: true },
        where: whereScoped,
      }),
      // Lista de assinantes com uso no período (ignora o filtro de assinante, para o seletor).
      db.iaUso.groupBy({ by: ["contaId"], where: wherePeriodo }),
    ]);

    const costMap = await iaPlatformService.getModelCostMap();
    const custoDe = (prompt: number, completion: number, modelId: string) => {
      const c = costMap.get(modelId) || { input: 0, output: 0 };
      return (prompt / 1_000_000) * c.input + (completion / 1_000_000) * c.output;
    };

    // ---- Por modelo ----
    const modelosMeta = await iaPlatformService.listModelos();
    const nomeModelo = new Map<string, string>(
      (modelosMeta as any[]).map((m) => [m.modelId, m.nome])
    );
    let custoTotal = 0;
    const porModelo = (porModeloRaw || [])
      .map((m: any) => {
        const custo = custoDe(m._sum?.promptTokens || 0, m._sum?.completionTokens || 0, m.modelId);
        custoTotal += custo;
        return {
          modelId: m.modelId,
          nome: nomeModelo.get(m.modelId) || m.modelId,
          tokens: m._sum?.totalTokens || 0,
          chamadas: m._count?._all || 0,
          custoEstimado: Number(custo.toFixed(4)),
        };
      })
      .sort((a: any, b: any) => b.tokens - a.tokens);

    // ---- Por função (feature) ----
    const featureMap = new Map<string, { tokens: number; chamadas: number; custo: number }>();
    for (const row of porFeatureModelRaw || []) {
      const acc = featureMap.get(row.feature) || { tokens: 0, chamadas: 0, custo: 0 };
      acc.tokens += row._sum?.totalTokens || 0;
      acc.chamadas += row._count?._all || 0;
      acc.custo += custoDe(row._sum?.promptTokens || 0, row._sum?.completionTokens || 0, row.modelId);
      featureMap.set(row.feature, acc);
    }
    const porFeature = Array.from(featureMap.entries())
      .map(([feature, v]) => ({
        feature,
        tokens: v.tokens,
        chamadas: v.chamadas,
        custoEstimado: Number(v.custo.toFixed(4)),
      }))
      .sort((a, b) => b.tokens - a.tokens);

    // ---- Por assinante (conta) ----
    const contaMap = new Map<number, { tokens: number; chamadas: number; custo: number }>();
    for (const row of porContaModelRaw || []) {
      const acc = contaMap.get(row.contaId) || { tokens: 0, chamadas: 0, custo: 0 };
      acc.tokens += row._sum?.totalTokens || 0;
      acc.chamadas += row._count?._all || 0;
      acc.custo += custoDe(row._sum?.promptTokens || 0, row._sum?.completionTokens || 0, row.modelId);
      contaMap.set(row.contaId, acc);
    }
    const contaIds = Array.from(contaMap.keys());
    // Ids de todos os assinantes do período (para o seletor) + os do escopo atual.
    const assinantesIds = (assinantesRaw || []).map((a: any) => a.contaId);
    const todosIds = Array.from(new Set<number>([...contaIds, ...assinantesIds]));
    const contas = todosIds.length
      ? await prisma.contas.findMany({
          where: { id: { in: todosIds } },
          select: { id: true, nome: true, nomeFantasia: true },
        })
      : [];
    const nomeConta = new Map<number, string>(
      contas.map((c) => [c.id, c.nomeFantasia?.trim() || c.nome])
    );
    const porConta = Array.from(contaMap.entries())
      .map(([contaId, v]) => ({
        contaId,
        nome: nomeConta.get(contaId) || `Conta #${contaId}`,
        tokens: v.tokens,
        chamadas: v.chamadas,
        custoEstimado: Number(v.custo.toFixed(4)),
      }))
      .sort((a, b) => b.tokens - a.tokens);

    // Assinantes disponíveis no período (para o filtro), em ordem alfabética.
    const assinantes = assinantesIds
      .map((id: number) => ({ contaId: id, nome: nomeConta.get(id) || `Conta #${id}` }))
      .sort((a: any, b: any) => a.nome.localeCompare(b.nome, "pt-BR"));

    return {
      mesInicio: start,
      mesFim: end,
      totalTokens: totalAgg?._sum?.totalTokens || 0,
      promptTokens: totalAgg?._sum?.promptTokens || 0,
      completionTokens: totalAgg?._sum?.completionTokens || 0,
      chamadas: totalAgg?._count?._all || 0,
      custoEstimado: Number(custoTotal.toFixed(4)),
      assinantesAtivos: contaIds.length,
      porFeature,
      porModelo,
      porConta,
      assinantes,
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
