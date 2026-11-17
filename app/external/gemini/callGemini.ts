import {
  Content,
  GoogleGenerativeAI,
  GenerateContentResult,
  Part,
  SchemaType,
  FunctionCallingMode,
} from "@google/generative-ai";
import { systemFunctionsIA, toolsIA } from "./gemini";
import { env } from "../../utils/dotenv";
import { CustomData } from "../../helpers/getCustomRequest";
import { hasPermission } from "../../helpers/userPermission";
import { prisma } from "../../utils/prisma";
import { iaPlatformService } from "../../services/ia/iaPlatformService";
import { iaUsageService } from "../../services/ia/iaUsageService";
import { retrieveCoreIaKnowledge } from "../../services/ia/coreIaKnowledgeMapper";
import { buildCoreIaSystemInstruction } from "../../services/ia/coreIaPromptBuilder";
import { CoreIaActions } from "../../services/ia/coreIaActions";
import { coreIaActionStore } from "../../services/ia/coreIaActionStore";
import {
  prepareCoreIaAction,
  todayInBrazil,
} from "../../services/ia/coreIaPrepareAction";
import {
  isWriteTool,
  requiredToolPermission,
  validateWrite,
} from "../../services/ia/coreIaToolPolicy";
import { textOnlyHistory } from "../../services/ia/coreIaProtocol";
import { runCoreIaAgent } from "../../services/ia/coreIaAgent";
import { identifyCoreIaIntent } from "../../services/ia/coreIaIntent";
import {
  transcribeCoreIaAudio,
  TRANSCRIPTION_INSTRUCTION,
} from "../../services/ia/coreIaTranscription";
import { resolverContaFinanceira } from "./tools/gestao";

export type CoreIaImageInput = {
  data: string;
  mimeType: string;
  name?: string;
};
export type CoreIaAudioInput = CoreIaImageInput;
const functions = systemFunctionsIA as Record<
  string,
  (args: any, request: CustomData) => Promise<any>
>;
const actions = new CoreIaActions(
  coreIaActionStore,
  async (name, args, request) => {
    if (
      !isWriteTool(name) ||
      !(await hasPermission(request, requiredToolPermission(name)))
    )
      return { error: "Você não tem permissão para esta operação." };
    // Sale arguments were resolved to a normal ERP payload at proposal time.
    const validated =
      name === "createVendaNova" ? args : validateWrite(name, args);
    return functions[name](validated, request);
  },
);

export const decideCoreIaAction = (
  id: string,
  decision: "confirm" | "cancel",
  request: CustomData,
) => actions.decide(id, decision, request);

export const callChatGeminiService = async (
  request: CustomData,
  prompt: string,
  history: Content[] = [],
  image?: CoreIaImageInput,
  audio?: CoreIaAudioInput,
): Promise<any> => {
  const coreConfig = await iaPlatformService.getCoreRuntimeConfig();
  if (!coreConfig.ativo)
    throw new Error("O Core IA está desativado pela plataforma no momento.");
  if (!coreConfig.apiKey)
    throw new Error(
      "Nenhuma chave de API configurada para o Core IA. Contate o administrador da plataforma.",
    );
  const genAI = new GoogleGenerativeAI(coreConfig.apiKey);
  const results: GenerateContentResult[] = [];
  try {
    let transcript: string | undefined;
    if (audio) {
      // Quarantined speech recognition: no ERP tools, no history and no execution authority.
      const transcriptionModel = genAI.getGenerativeModel(
        {
          model: coreConfig.modelId,
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: {
              type: SchemaType.OBJECT,
              properties: { transcript: { type: SchemaType.STRING } },
              required: ["transcript"],
            },
            maxOutputTokens: 4096,
          },
          systemInstruction: TRANSCRIPTION_INSTRUCTION,
        },
        { timeout: 60_000 },
      );
      transcript = await transcribeCoreIaAudio(audio, async (parts) => {
        const result = await transcriptionModel.generateContent(parts);
        results.push(result);
        return result.response.text();
      });
      prompt = [
        `Transcrição do áudio enviado pelo usuário:\n${transcript}`,
        prompt.trim()
          ? `Mensagem digitada pelo usuário (complementos e correções da fala):\n${prompt}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      await iaUsageService.assertWithinQuota(request.contaId);
    }
    const cleanHistory = textOnlyHistory(history);
    const retrievalQuery = [
      ...cleanHistory
        .filter((item) => item.role === "user")
        .slice(-2)
        .flatMap((item) => item.parts.map((part) => part.text || "")),
      prompt,
    ]
      .join("\n")
      .slice(-10000);
    const intent = identifyCoreIaIntent(prompt);
    const knowledge = retrieveCoreIaKnowledge({ prompt: retrievalQuery });
    const model = genAI.getGenerativeModel(
      {
        model: coreConfig.modelId,
        tools: toolsIA,
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
        systemInstruction: buildCoreIaSystemInstruction({
          systemPrompt: coreConfig.systemPrompt,
          knowledgeContext: knowledge.context,
          hoje: todayInBrazil(),
          baseUrlFrontend: env.BASE_URL_FRONTEND,
          temImagem: Boolean(image),
          intentContext: `${intent.mode}: ${intent.entity}`,
        }),
      },
      { timeout: 60_000 },
    );
    let chat = model.startChat({ history: cleanHistory });
    const intentTool: Record<string, string> = {
      cliente: "createClienteNovo",
      produto: "createProdutoNovo",
      serviço: "createServicoNovo",
      "lançamento financeiro": "createLancamentoFinanceiro",
      venda: "createVendaNova",
    };
    const trackedChat = {
      async sendMessage(message: string | Part[], requireTool = false) {
        if (
          requireTool &&
          intent.mode === "cadastro" &&
          intentTool[intent.entity]
        ) {
          chat = model.startChat({
            history: await chat.getHistory(),
            toolConfig: {
              functionCallingConfig: {
                mode: FunctionCallingMode.ANY,
                allowedFunctionNames: [intentTool[intent.entity]],
              },
            },
          });
        }
        const result = await chat.sendMessage(message);
        results.push(result);
        if (requireTool)
          chat = model.startChat({ history: await chat.getHistory() });
        return result;
      },
      getHistory: () => chat.getHistory(),
    };
    const message: string | Part[] = image
      ? [
          { inlineData: { data: image.data, mimeType: image.mimeType } },
          {
            text: prompt || "Analise a imagem e destaque as informações úteis.",
          },
        ]
      : prompt;
    const response = await runCoreIaAgent(message, request, {
      chat: trackedChat,
      actions,
      authorize: hasPermission,
      prepare: (name, args, request) =>
        prepareCoreIaAction(
          name,
          args,
          request,
          prisma,
          resolverContaFinanceira,
        ),
      read: (name, args, request) => functions[name](args, request),
      knownTools: new Set(Object.keys(functions)),
    });
    return { ...response, transcript, intent, sources: knowledge.sources };
  } finally {
    await iaUsageService.recordUsage({
      contaId: request.contaId,
      feature: "core_chat",
      provider: coreConfig.provider,
      modelId: coreConfig.modelId,
      promptTokens: results.reduce(
        (sum, item) =>
          sum + (item.response.usageMetadata?.promptTokenCount || 0),
        0,
      ),
      completionTokens: results.reduce(
        (sum, item) =>
          sum + (item.response.usageMetadata?.candidatesTokenCount || 0),
        0,
      ),
      totalTokens: results.reduce(
        (sum, item) =>
          sum + (item.response.usageMetadata?.totalTokenCount || 0),
        0,
      ),
    });
  }
};
