import { Content, GoogleGenerativeAI } from "@google/generative-ai";
import { systemFunctionsIA, toolsIA } from "./gemini";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  tools: toolsIA,
});

export const callChatGeminiService = async (
  prompt: string,
  history?: Content[]
): Promise<any> => {
  if (!prompt) {
    return { error: "Mensagem é obrigatória" };
  }

  // Inicia o chat com o histórico enviado pelo front-end
  const chat = model.startChat({
    history: history || [],
  });

  // Envia a mensagem do usuário
  let result = await chat.sendMessage(prompt);
  let response = result.response;

  // Lógica de Chamada de Função (Function Calling)
  const calls = response.functionCalls();

  if (calls) {
    const functionResponses = [];

    for (const call of calls) {
      const fnName = call.name as keyof typeof systemFunctionsIA;
      const fnArgs = call.args;

      // Executa a lógica do seu sistema
      const apiResponse = await systemFunctionsIA[fnName](fnArgs as any);

      functionResponses.push({
        functionResponse: {
          name: fnName,
          response: apiResponse,
        },
      });
    }

    // Envia os resultados das funções de volta para a IA para o texto final
    const finalResult = await chat.sendMessage(functionResponses);

    return {
      reply: finalResult.response.text(),
      history: await chat.getHistory(), // Retorna o histórico atualizado
    };
  }

  return {
    reply: response.text(),
    history: await chat.getHistory(),
  };
};
