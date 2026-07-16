import { Prisma } from "../../../generated";
import { prisma } from "../../utils/prisma";

// Configuração de IA da plataforma (gerenciada pelo CEO/super admin). Centraliza as chaves de
// API e os modelos que os assinantes podem usar nos agentes — o cliente final não informa a
// própria chave: usa a chave marcada como padrão e apenas os modelos ativos.

const DEFAULT_PROVIDER = "gemini";

// Modelos usados como fallback enquanto o CEO não cadastra nenhum (para não travar os agentes).
export const DEFAULT_GEMINI_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
];

export function maskApiKey(key?: string | null): string {
  const value = String(key || "");
  if (value.length <= 4) return value ? "••••" : "";
  return `••••••••${value.slice(-4)}`;
}

function publicChave(chave: any) {
  if (!chave) return chave;
  const { apiKey, ...rest } = chave;
  return { ...rest, apiKeyMasked: maskApiKey(apiKey) };
}

export interface ChaveInput {
  nome: string;
  apiKey?: string;
  provider?: string;
  ativo?: boolean;
  isPadrao?: boolean;
}

export interface ModeloInput {
  modelId: string;
  nome: string;
  provider?: string;
  ativo?: boolean;
  custoInputMilhao?: number | null;
  custoOutputMilhao?: number | null;
}

export interface CoreConfigInput {
  provider?: string;
  modelId?: string;
  apiKey?: string;
  systemPrompt?: string;
  ativo?: boolean;
  limiteTokensMensalPadrao?: number | null;
}

// Prompt de sistema padrão do Core IA (usado enquanto o CEO não define um próprio). A data atual
// e o link do site são anexados em tempo de execução (ver callGemini) para não ficarem estáticos.
export const DEFAULT_CORE_SYSTEM_PROMPT = `Você é um assistente de gestão ERP, seu nome é Core e tem a missão de ajudar a gestão de negócios.
Regras de comportamento:
1. Seja direto, profissional e prestativo.
2. Use sempre as ferramentas (functions) disponíveis para registrar ou consultar dados.
3. Use Markdown para formatar listas, negritos, tabelas, headers e dados que vêm em formato JSON, escolha a melhor formatação para facilitar a visualização do cliente.
4. Se o usuário pedir algo fora do escopo de ERP, tente trazer o foco de volta para a gestão do negócio.
5. Pode ajudar o cliente com perguntas simples fora do escopo ERP, como cálculos matemáticos, etc.`;

const DEFAULT_CORE_MODEL = "gemini-2.0-flash-lite";

export const iaPlatformService = {
  // ---------------- Chaves API ----------------
  async listChaves() {
    const chaves = await prisma.iaChaveApi.findMany({
      orderBy: [{ isPadrao: "desc" }, { createdAt: "desc" }],
    });
    return chaves.map(publicChave);
  },

  // Marca a chave como padrão de forma exclusiva (uma única padrão por provider) e garante ativa.
  async setPadraoExclusivo(id: number, provider: string) {
    await prisma.$transaction([
      prisma.iaChaveApi.updateMany({ where: { provider, id: { not: id } }, data: { isPadrao: false } }),
      prisma.iaChaveApi.update({ where: { id }, data: { isPadrao: true, ativo: true } }),
    ]);
  },

  async createChave(input: ChaveInput) {
    if (!input.apiKey?.trim()) throw new Error("Informe a chave de API");
    const provider = input.provider?.trim() || DEFAULT_PROVIDER;
    const chave = await prisma.iaChaveApi.create({
      data: {
        nome: input.nome.trim(),
        provider,
        apiKey: input.apiKey.trim(),
        ativo: input.ativo ?? true,
        isPadrao: false,
      },
    });
    if (input.isPadrao) await this.setPadraoExclusivo(chave.id, provider);
    return publicChave(await prisma.iaChaveApi.findUnique({ where: { id: chave.id } }));
  },

  async updateChave(id: number, input: ChaveInput) {
    const existing = await prisma.iaChaveApi.findUnique({ where: { id } });
    if (!existing) throw new Error("Chave de API não encontrada");

    const data: Prisma.IaChaveApiUpdateInput = {};
    if (typeof input.nome === "string") data.nome = input.nome.trim();
    if (typeof input.provider === "string" && input.provider.trim()) data.provider = input.provider.trim();
    // Só atualiza a chave se veio um valor novo (o front não reenvia a chave existente).
    if (typeof input.apiKey === "string" && input.apiKey.trim()) data.apiKey = input.apiKey.trim();
    if (typeof input.ativo === "boolean") data.ativo = input.ativo;

    await prisma.iaChaveApi.update({ where: { id }, data });
    if (input.isPadrao) await this.setPadraoExclusivo(id, input.provider?.trim() || existing.provider);
    return publicChave(await prisma.iaChaveApi.findUnique({ where: { id } }));
  },

  async removeChave(id: number) {
    await prisma.iaChaveApi.delete({ where: { id } });
    return { id };
  },

  // ---------------- Modelos ----------------
  async listModelos() {
    return prisma.iaModelo.findMany({ orderBy: [{ ativo: "desc" }, { modelId: "asc" }] });
  },

  async createModelo(input: ModeloInput) {
    return prisma.iaModelo.create({
      data: {
        modelId: input.modelId.trim(),
        nome: input.nome.trim(),
        provider: input.provider?.trim() || DEFAULT_PROVIDER,
        ativo: input.ativo ?? true,
        custoInputMilhao: input.custoInputMilhao ?? null,
        custoOutputMilhao: input.custoOutputMilhao ?? null,
      } as any,
    });
  },

  async updateModelo(id: number, input: Partial<ModeloInput>) {
    const data: Prisma.IaModeloUpdateInput = {};
    if (typeof input.modelId === "string" && input.modelId.trim()) data.modelId = input.modelId.trim();
    if (typeof input.nome === "string") data.nome = input.nome.trim();
    if (typeof input.provider === "string" && input.provider.trim()) data.provider = input.provider.trim();
    if (typeof input.ativo === "boolean") data.ativo = input.ativo;
    if (input.custoInputMilhao === null || typeof input.custoInputMilhao === "number") {
      (data as any).custoInputMilhao = input.custoInputMilhao;
    }
    if (input.custoOutputMilhao === null || typeof input.custoOutputMilhao === "number") {
      (data as any).custoOutputMilhao = input.custoOutputMilhao;
    }
    return prisma.iaModelo.update({ where: { id }, data });
  },

  // Mapa modelId -> custo por milhão (entrada/saída) para estimar gasto a partir de IaUso.
  async getModelCostMap(): Promise<Map<string, { input: number; output: number }>> {
    const modelos = await prisma.iaModelo.findMany();
    const map = new Map<string, { input: number; output: number }>();
    for (const m of modelos as any[]) {
      map.set(m.modelId, {
        input: Number(m.custoInputMilhao ?? 0),
        output: Number(m.custoOutputMilhao ?? 0),
      });
    }
    return map;
  },

  async removeModelo(id: number) {
    await prisma.iaModelo.delete({ where: { id } });
    return { id };
  },

  // ---------------- Consumo pelos agentes ----------------
  // Chave de API (texto puro) usada por TODOS os recursos de IA. Fonte única: a tela "Chaves de
  // API" do CEO (IaChaveApi). Prioriza a chave marcada como padrão; senão, qualquer chave ativa
  // do provider. Sem fallback para a env — se não houver chave ATIVA, a IA para em todas as
  // contas (retorna null). A env GEMINI_API_KEY não é mais usada.
  async getDefaultApiKey(provider = DEFAULT_PROVIDER): Promise<string | null> {
    const chave = await prisma.iaChaveApi.findFirst({
      where: { provider, ativo: true },
      orderBy: [{ isPadrao: "desc" }, { updatedAt: "desc" }],
    });
    return chave?.apiKey || null;
  },

  // IDs dos modelos ativos ofertados aos assinantes. Se o CEO ainda não cadastrou modelos,
  // devolve a lista padrão.
  async getActiveModelIds(provider = DEFAULT_PROVIDER): Promise<string[]> {
    const modelos = await prisma.iaModelo.findMany({
      where: { provider, ativo: true },
      orderBy: { modelId: "asc" },
      select: { modelId: true },
    });
    const ids = modelos.map((m) => m.modelId);
    return ids.length ? ids : DEFAULT_GEMINI_MODELS;
  },

  // ---------------- Core IA (assistente interno do ERP) ----------------
  // Config singleton: cria a linha padrão na primeira leitura para simplificar o consumo.
  async getCoreConfigRow() {
    const existing = await prisma.iaCoreConfig.findFirst({ orderBy: { id: "asc" } });
    if (existing) return existing;
    return prisma.iaCoreConfig.create({ data: {} });
  },

  // Versão para a tela do CEO: nunca expõe a chave em texto puro, apenas mascarada.
  async getCoreConfig() {
    const cfg = await this.getCoreConfigRow();
    const { apiKey, ...rest } = cfg;
    return {
      ...rest,
      systemPrompt: cfg.systemPrompt ?? "",
      defaultSystemPrompt: DEFAULT_CORE_SYSTEM_PROMPT,
      apiKeyMasked: maskApiKey(apiKey),
      apiKeyConfigured: Boolean(apiKey),
    };
  },

  async saveCoreConfig(input: CoreConfigInput) {
    const cfg = await this.getCoreConfigRow();
    const data: Prisma.IaCoreConfigUpdateInput = {};
    if (typeof input.provider === "string" && input.provider.trim()) data.provider = input.provider.trim();
    if (typeof input.modelId === "string" && input.modelId.trim()) data.modelId = input.modelId.trim();
    // A chave só é sobrescrita quando um valor novo é enviado (o front não reenvia a existente).
    if (typeof input.apiKey === "string" && input.apiKey.trim()) data.apiKey = input.apiKey.trim();
    if (typeof input.systemPrompt === "string") data.systemPrompt = input.systemPrompt.trim() || null;
    if (typeof input.ativo === "boolean") data.ativo = input.ativo;
    if (input.limiteTokensMensalPadrao === null || typeof input.limiteTokensMensalPadrao === "number") {
      (data as any).limiteTokensMensalPadrao = input.limiteTokensMensalPadrao;
    }
    await prisma.iaCoreConfig.update({ where: { id: cfg.id }, data });
    return this.getCoreConfig();
  },

  // Config efetiva usada em runtime pelo Core IA e por todas as features de texto. A chave vem
  // SEMPRE da tela "Chaves de API" (getDefaultApiKey), nunca da env nem da chave dedicada do
  // Core IA — assim, desativar a chave no painel do CEO para a IA em toda a plataforma.
  async getCoreRuntimeConfig(): Promise<{
    ativo: boolean;
    provider: string;
    modelId: string;
    apiKey: string | null;
    systemPrompt: string;
  }> {
    const cfg = await this.getCoreConfigRow();
    const provider = cfg.provider || DEFAULT_PROVIDER;
    return {
      ativo: cfg.ativo,
      provider,
      modelId: cfg.modelId?.trim() || DEFAULT_CORE_MODEL,
      apiKey: await this.getDefaultApiKey(provider),
      systemPrompt: cfg.systemPrompt?.trim() || DEFAULT_CORE_SYSTEM_PROMPT,
    };
  },
};
