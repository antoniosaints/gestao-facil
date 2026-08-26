import { Content, GoogleGenerativeAI, Part, SchemaType, Tool } from "@google/generative-ai";

// Integração Gemini para os agentes de autoatendimento do WhatsApp. A chave de API e os
// modelos permitidos são definidos pelo CEO (iaPlatformService) e passados pelo chamador —
// o assinante não informa a própria chave. Suporta anexos (imagem, PDF, áudio, vídeo).

export interface AgentHistoryItem {
  role: "user" | "model";
  text: string;
}

export interface AgentMediaInput {
  mimeType: string;
  dataBase64: string;
}

// A confirmação do pedido não pode depender de texto livre do modelo. Esta função é
// oferecida apenas quando há contexto de Restaurante e é executada pelo serviço que
// possui a conversa/tenant, criando o pedido e o Pix na mesma operação idempotente.
export const restaurantOrderTool: Tool[] = [{
  functionDeclarations: [{
    name: "criar_pedido_restaurante",
    description: "Cria o pedido confirmado do restaurante. Para pagamento PIX, gera obrigatoriamente uma cobrança Pix do Mercado Pago vinculada ao pedido. Use somente depois que o cliente confirmar todos os dados, itens e forma de pagamento. Nunca confirme o pedido em texto antes de a ferramenta retornar sucesso.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        origem: { type: SchemaType.STRING, format: "enum", enum: ["RETIRADA", "DELIVERY"], description: "Forma de recebimento confirmada." },
        pagamento: { type: SchemaType.STRING, format: "enum", enum: ["NA_ENTREGA", "PIX"], description: "Forma de pagamento confirmada." },
        cliente: {
          type: SchemaType.OBJECT,
          properties: {
            nome: { type: SchemaType.STRING },
            telefone: { type: SchemaType.STRING },
            email: { type: SchemaType.STRING, nullable: true },
          },
          required: ["nome", "telefone"],
        },
        endereco: {
          type: SchemaType.OBJECT,
          properties: {
            cep: { type: SchemaType.STRING }, cidade: { type: SchemaType.STRING }, bairro: { type: SchemaType.STRING },
            logradouro: { type: SchemaType.STRING }, numero: { type: SchemaType.STRING },
            complemento: { type: SchemaType.STRING, nullable: true }, referencia: { type: SchemaType.STRING, nullable: true },
          },
          required: ["cep", "cidade", "bairro", "logradouro", "numero"],
        },
        observacao: { type: SchemaType.STRING },
        itens: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              catalogoItemId: { type: SchemaType.INTEGER }, quantidade: { type: SchemaType.NUMBER },
              selecaoIds: { type: SchemaType.ARRAY, items: { type: SchemaType.INTEGER } },
              tamanho: { type: SchemaType.STRING }, observacao: { type: SchemaType.STRING },
            },
            required: ["catalogoItemId", "quantidade", "selecaoIds"],
          },
        },
      },
      required: ["origem", "pagamento", "cliente", "itens"],
    },
  }],
}];

// Tipos de arquivo que o Gemini consegue interpretar como anexo.
export function geminiSupportsMime(mimetype?: string | null): boolean {
  const mime = String(mimetype || "").toLowerCase();
  return (
    mime.startsWith("image/") ||
    mime.startsWith("audio/") ||
    mime.startsWith("video/") ||
    mime === "application/pdf"
  );
}

// A history do chat deve começar com "user" e não pode ter papéis repetidos em sequência;
// mesclamos mensagens consecutivas do mesmo papel e removemos "model" inicial.
function buildHistory(items: AgentHistoryItem[]): Content[] {
  const contents: Content[] = [];
  for (const item of items) {
    if (!item.text?.trim()) continue;
    const last = contents[contents.length - 1];
    if (last && last.role === item.role) {
      (last.parts as Part[]).push({ text: item.text });
    } else {
      contents.push({ role: item.role, parts: [{ text: item.text }] });
    }
  }
  while (contents.length && contents[0].role !== "user") contents.shift();
  return contents;
}

export interface AgentReplyResult {
  text: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  functionCalls: Array<{ name: string; args: object }>;
}

export async function generateAgentReply(params: {
  apiKey: string;
  modelo: string;
  systemPrompt: string;
  history: AgentHistoryItem[];
  userText: string;
  media?: AgentMediaInput | null;
  tools?: Tool[];
}): Promise<AgentReplyResult> {
  if (!params.apiKey) {
    throw new Error("Nenhuma chave de API de IA configurada pela plataforma");
  }
  const genAI = new GoogleGenerativeAI(params.apiKey);
  const model = genAI.getGenerativeModel({
    model: params.modelo || "gemini-2.0-flash",
    tools: params.tools,
    systemInstruction: { role: "system", parts: [{ text: params.systemPrompt }] },
  });

  const chat = model.startChat({ history: buildHistory(params.history) });

  const parts: Part[] = [];
  if (params.media?.dataBase64) {
    parts.push({ inlineData: { mimeType: params.media.mimeType, data: params.media.dataBase64 } });
  }
  parts.push({ text: params.userText?.trim() || "(mensagem sem texto)" });

  const result = await chat.sendMessage(parts);
  const meta = result.response.usageMetadata;
  let text = "";
  try { text = result.response.text(); } catch { /* A resposta pode conter somente function call. */ }
  return {
    text,
    usage: {
      promptTokens: meta?.promptTokenCount || 0,
      completionTokens: meta?.candidatesTokenCount || 0,
      totalTokens: meta?.totalTokenCount || 0,
    },
    functionCalls: (result.response.functionCalls() || []).map((call) => ({ name: call.name, args: call.args })),
  };
}
