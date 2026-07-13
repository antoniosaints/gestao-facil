import { Prisma } from "../../../generated";
import { prisma } from "../../utils/prisma";
import { env } from "../../utils/dotenv";

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
}

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
      },
    });
  },

  async updateModelo(id: number, input: Partial<ModeloInput>) {
    const data: Prisma.IaModeloUpdateInput = {};
    if (typeof input.modelId === "string" && input.modelId.trim()) data.modelId = input.modelId.trim();
    if (typeof input.nome === "string") data.nome = input.nome.trim();
    if (typeof input.provider === "string" && input.provider.trim()) data.provider = input.provider.trim();
    if (typeof input.ativo === "boolean") data.ativo = input.ativo;
    return prisma.iaModelo.update({ where: { id }, data });
  },

  async removeModelo(id: number) {
    await prisma.iaModelo.delete({ where: { id } });
    return { id };
  },

  // ---------------- Consumo pelos agentes ----------------
  // Chave de API (texto puro) usada pelos assinantes. Fallback para a env enquanto o CEO não
  // configura nenhuma, para os agentes não pararem.
  async getDefaultApiKey(provider = DEFAULT_PROVIDER): Promise<string | null> {
    const chave = await prisma.iaChaveApi.findFirst({
      where: { provider, ativo: true, isPadrao: true },
      orderBy: { updatedAt: "desc" },
    });
    return chave?.apiKey || env.GEMINI_API_KEY || null;
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
};
