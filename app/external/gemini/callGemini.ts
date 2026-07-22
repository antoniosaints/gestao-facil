import { Content, GoogleGenerativeAI, GenerateContentResult, Part } from "@google/generative-ai";
import { systemFunctionsIA, toolsIA } from "./gemini";
import { env } from "../../utils/dotenv";
import { CustomData } from "../../helpers/getCustomRequest";
import { iaPlatformService } from "../../services/ia/iaPlatformService";
import { iaUsageService } from "../../services/ia/iaUsageService";
import { buildCoreIaKnowledgeContext } from "../../services/ia/coreIaKnowledgeMapper";
import { buildCoreIaSystemInstruction } from "../../services/ia/coreIaPromptBuilder";

export type CoreIaImageInput = {
  data: string;
  mimeType: string;
  name?: string;
};

function sanitizeHistory(history: Content[] = []): Content[] {
  return history.map((item) => ({
    ...item,
    parts: (item.parts || []).map((part: any) => {
      if (part?.inlineData) {
        return { text: "[Imagem enviada anteriormente e descartada após processamento]" };
      }
      return part;
    }),
  }));
}

function normalizeImageInput(image?: CoreIaImageInput): CoreIaImageInput | null {
  if (!image?.data?.trim() || !image?.mimeType?.trim()) return null;

  const data = image.data.includes(",") ? image.data.split(",").pop() || "" : image.data;
  const mimeType = image.mimeType.trim().toLowerCase();

  if (!mimeType.startsWith("image/") || !data.trim()) return null;

  return {
    data: data.trim(),
    mimeType,
    name: image.name,
  };
}

export const callChatGeminiService = async (
  request: CustomData,
  prompt: string,
  history?: Content[],
  image?: CoreIaImageInput,
): Promise<any> => {
  const normalizedImage = normalizeImageInput(image);

  if (!prompt && !normalizedImage) {
    return { error: "Mensagem é obrigatória" };
  }

  // Modelo, chave de API e prompt de sistema são definidos pelo CEO (config do Core IA). O
  // modelo é montado por requisição para refletir mudanças sem reiniciar o servidor.
  const coreConfig = await iaPlatformService.getCoreRuntimeConfig();
  if (!coreConfig.ativo) {
    return { error: "O Core IA está desativado pela plataforma no momento." };
  }
  if (!coreConfig.apiKey) {
    return { error: "Nenhuma chave de API configurada para o Core IA. Contate o administrador da plataforma." };
  }

  // O prompt do CEO é a camada de identidade; o método de trabalho e as regras de
  // execução vêm do builder, que roda sempre — inclusive para contas que salvaram
  // um prompt customizado.
  const finalSystemInstructionText = buildCoreIaSystemInstruction({
    systemPrompt: coreConfig.systemPrompt,
    knowledgeContext: buildCoreIaKnowledgeContext({ prompt: prompt || "" }),
    hoje: new Date().toISOString().split("T")[0],
    baseUrlFrontend: env.BASE_URL_FRONTEND,
    temImagem: Boolean(normalizedImage),
  });

  const genAI = new GoogleGenerativeAI(coreConfig.apiKey);
  const model = genAI.getGenerativeModel({
    model: coreConfig.modelId,
    tools: toolsIA,
    systemInstruction: {
      role: "system",
      parts: [{ text: finalSystemInstructionText }],
    },
  });

  // Inicia o chat com o histórico enviado pelo front-end
  const chat = model.startChat({
    history: sanitizeHistory(history || []),
  });

  // Acumula o consumo de tokens das chamadas ao modelo (registrado ao final).
  const results: GenerateContentResult[] = [];
  const recordUsage = async () => {
    let prompt = 0;
    let completion = 0;
    let total = 0;
    for (const r of results) {
      const meta = r.response.usageMetadata;
      prompt += meta?.promptTokenCount || 0;
      completion += meta?.candidatesTokenCount || 0;
      total += meta?.totalTokenCount || 0;
    }
    await iaUsageService.recordUsage({
      contaId: request.contaId,
      feature: "core_chat",
      provider: coreConfig.provider,
      modelId: coreConfig.modelId,
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: total,
    });
  };

  // Envia a mensagem do usuário
  const userMessage: string | Part[] = normalizedImage
    ? [
        { inlineData: { mimeType: normalizedImage.mimeType, data: normalizedImage.data } },
        {
          text: [
            "A mensagem do usuario contem uma imagem anexada.",
            "Analise obrigatoriamente o conteudo visual da imagem.",
            prompt?.trim() || "Descreva a imagem em portugues e destaque informacoes uteis.",
          ].join("\n"),
        },
      ]
    : prompt;
  let result = await chat.sendMessage(userMessage);
  results.push(result);

  // Lógica de Chamada de Função (Function Calling) em múltiplas rodadas: o modelo pode encadear
  // ferramentas (ex.: buscar o ID de um produto e depois repor o estoque). Iteramos até ele
  // devolver texto, com um limite de segurança contra loops.
  // Fluxos de análise reais encadeiam várias leituras antes de concluir; 6 rodadas
  // estouravam no meio e devolviam a mensagem de limite.
  const MAX_ROUNDS = 10;
  let calls = result.response.functionCalls();
  let rounds = 0;

  while (calls && calls.length && rounds < MAX_ROUNDS) {
    rounds++;
    const functionResponses = [];

    for (const call of calls) {
      const fnName = call.name as keyof typeof systemFunctionsIA;
      const fn = systemFunctionsIA[fnName];

      // Executa a lógica do sistema. Falhas de uma ferramenta (ex.: dado inválido numa escrita)
      // viram um erro devolvido ao modelo — que explica ao usuário — em vez de derrubar a request.
      let apiResponse: any;
      if (typeof fn !== "function") {
        apiResponse = { error: `Função "${String(fnName)}" não encontrada.` };
      } else {
        try {
          apiResponse = await fn(call.args as any, request);
        } catch (err: any) {
          console.warn(`[core-ia] falha na ferramenta ${String(fnName)}:`, err);
          apiResponse = { error: err?.message || "Não foi possível executar a operação." };
        }
      }

      functionResponses.push({
        functionResponse: { name: fnName, response: apiResponse },
      });
    }

    // Envia os resultados das funções de volta para a IA (pode gerar novas chamadas).
    result = await chat.sendMessage(functionResponses);
    results.push(result);
    calls = result.response.functionCalls();
  }

  await recordUsage();

  // Se ainda restarem chamadas pendentes (limite atingido), não há texto para extrair.
  let reply = "";
  if (calls && calls.length) {
    reply =
      "A consulta ficou complexa demais e não consegui concluir em uma única resposta. " +
      "Tente dividir em partes — por exemplo, peça primeiro os números do período e depois a análise.";
  } else {
    try {
      reply = result.response.text();
    } catch {
      reply = "";
    }
  }

  // Nunca devolve resposta vazia (ex.: o modelo executa uma ferramenta e não escreve texto no
  // fim) — isso deixaria um balão vazio no chat. Damos um retorno neutro de confirmação.
  if (!reply.trim()) {
    reply = "Pronto! ✅ Posso ajudar em mais alguma coisa?";
  }

  return {
    reply,
    history: sanitizeHistory(await chat.getHistory()),
  };
};
