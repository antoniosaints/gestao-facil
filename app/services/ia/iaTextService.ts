import { GoogleGenerativeAI, Part } from "@google/generative-ai";
import { iaPlatformService } from "./iaPlatformService";
import { iaUsageService } from "./iaUsageService";

// Serviço genérico de geração de texto com Gemini, reaproveitando a config do Core IA
// (chave/modelo/prompt definidos pelo CEO). É o backbone de todas as features de IA de texto:
// verifica a quota da conta, gera (single-shot, com suporte a mídia e saída JSON estruturada) e
// registra o consumo de tokens.

export interface GenerateTextUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface GenerateTextParams {
  contaId: number;
  feature: string;
  prompt: string;
  systemInstruction?: string;
  media?: { mimeType: string; dataBase64: string } | null;
  json?: boolean;
  responseSchema?: any;
  // Por padrão verifica a quota mensal; passe false para pular (ex.: chamadas internas).
  checkQuota?: boolean;
}

export async function generateText(
  params: GenerateTextParams
): Promise<{ text: string; usage: GenerateTextUsage }> {
  if (params.checkQuota !== false) {
    await iaUsageService.assertWithinQuota(params.contaId);
  }

  const cfg = await iaPlatformService.getCoreRuntimeConfig();
  if (!cfg.ativo) {
    throw new Error("O Core IA está desativado pela plataforma no momento.");
  }
  if (!cfg.apiKey) {
    throw new Error(
      "Nenhuma chave de API configurada para o Core IA. Contate o administrador da plataforma."
    );
  }

  const genAI = new GoogleGenerativeAI(cfg.apiKey);

  const generationConfig: Record<string, any> = {};
  if (params.json) {
    generationConfig.responseMimeType = "application/json";
    if (params.responseSchema) generationConfig.responseSchema = params.responseSchema;
  }

  const model = genAI.getGenerativeModel({
    model: cfg.modelId,
    systemInstruction: params.systemInstruction
      ? { role: "system", parts: [{ text: params.systemInstruction }] }
      : undefined,
    generationConfig,
  });

  const parts: Part[] = [];
  if (params.media?.dataBase64) {
    parts.push({
      inlineData: { mimeType: params.media.mimeType, data: params.media.dataBase64 },
    });
  }
  parts.push({ text: params.prompt });

  const result = await model.generateContent({ contents: [{ role: "user", parts }] });

  const meta = result.response.usageMetadata;
  const usage: GenerateTextUsage = {
    promptTokens: meta?.promptTokenCount || 0,
    completionTokens: meta?.candidatesTokenCount || 0,
    totalTokens: meta?.totalTokenCount || 0,
  };

  await iaUsageService.recordUsage({
    contaId: params.contaId,
    feature: params.feature,
    provider: cfg.provider,
    modelId: cfg.modelId,
    ...usage,
  });

  return { text: result.response.text(), usage };
}
