import { Content, GoogleGenerativeAI } from "@google/generative-ai";
import { systemFunctionsIA, toolsIA } from "./gemini";
import { env } from "../utils/dotenv";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  tools: toolsIA,
  systemInstruction: {
    role: "system",
    parts: [
      {
        text: `Você é um assistente de gestão ERP, seu nome é Core e tem a missão de ajudar a gestão de negócios.
        Regras de comportamento:
        1. Seja direto, profissional e prestativo.
        2. Use sempre as ferramentas (functions) disponíveis para registrar ou consultar dados.
        3. Use Markdown para formatar listas, negritos e tabelas.
        4. Se o usuário pedir algo fora do escopo de ERP, tente trazer o foco de volta para a gestão do negócio.
        5. Pode ajudar o usuário em perguntas extra ERP, mas caso perceba que o mesmo está tentando algum assunto ilegal, não ajudar.`,
      },
    ],
  },
});

export const callChatGeminiService = async (
  accountId: number,
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
      const apiResponse = await systemFunctionsIA[fnName](fnArgs as any, accountId);

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
