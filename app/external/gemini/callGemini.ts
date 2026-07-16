import { Content, GoogleGenerativeAI, GenerateContentResult } from "@google/generative-ai";
import { systemFunctionsIA, toolsIA } from "./gemini";
import { env } from "../../utils/dotenv";
import { CustomData } from "../../helpers/getCustomRequest";
import { iaPlatformService } from "../../services/ia/iaPlatformService";
import { iaUsageService } from "../../services/ia/iaUsageService";

export const callChatGeminiService = async (
  request: CustomData,
  prompt: string,
  history?: Content[]
): Promise<any> => {
  if (!prompt) {
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

  // Anexamos ao prompt do CEO um contexto dinâmico (data atual + link do site) para que as
  // ferramentas e a data continuem corretas independentemente do texto configurado.
  const systemInstructionText = `${coreConfig.systemPrompt}

Contexto adicional: a data atual de hoje é ${new Date().toISOString().split("T")[0]}. Caso o usuário queira acessar o site, envie um link em formato markdown para "${env.BASE_URL_FRONTEND}/site".`;

  const genAI = new GoogleGenerativeAI(coreConfig.apiKey);
  const model = genAI.getGenerativeModel({
    model: coreConfig.modelId,
    tools: toolsIA,
    systemInstruction: {
      role: "system",
      parts: [{ text: systemInstructionText }],
    },
  });

  // Inicia o chat com o histórico enviado pelo front-end
  const chat = model.startChat({
    history: history || [],
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
  let result = await chat.sendMessage(prompt);
  results.push(result);
  let response = result.response;

  // Lógica de Chamada de Função (Function Calling)
  const calls = response.functionCalls();

  if (calls) {
    const functionResponses = [];

    for (const call of calls) {
      const fnName = call.name as keyof typeof systemFunctionsIA;
      const fnArgs = call.args;

      // Executa a lógica do seu sistema
      const apiResponse = await systemFunctionsIA[fnName](fnArgs as any, request);

      functionResponses.push({
        functionResponse: {
          name: fnName,
          response: apiResponse,
        },
      });
    }

    // Envia os resultados das funções de volta para a IA para o texto final
    const finalResult = await chat.sendMessage(functionResponses);
    results.push(finalResult);
    await recordUsage();

    return {
      reply: finalResult.response.text(),
      history: await chat.getHistory(), // Retorna o histórico atualizado
    };
  }

  await recordUsage();

  return {
    reply: response.text(),
    history: await chat.getHistory(),
  };
};
