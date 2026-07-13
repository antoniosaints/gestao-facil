import { Content, GoogleGenerativeAI, Part } from "@google/generative-ai";
import { env } from "../../utils/dotenv";

// Integração Gemini para os agentes de autoatendimento do WhatsApp. Reaproveita a mesma
// GEMINI_API_KEY já usada no módulo Core IA, mas com modelo/prompt configuráveis por agente
// e suporte a anexos (imagem, PDF, áudio, vídeo) via inlineData.

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

export interface AgentHistoryItem {
  role: "user" | "model";
  text: string;
}

export interface AgentMediaInput {
  mimeType: string;
  dataBase64: string;
}

// Modelos oferecidos na criação do agente (o front lista estes).
export const AGENT_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
];

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

export async function generateAgentReply(params: {
  modelo: string;
  systemPrompt: string;
  history: AgentHistoryItem[];
  userText: string;
  media?: AgentMediaInput | null;
}): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: params.modelo || "gemini-2.0-flash",
    systemInstruction: { role: "system", parts: [{ text: params.systemPrompt }] },
  });

  const chat = model.startChat({ history: buildHistory(params.history) });

  const parts: Part[] = [];
  if (params.media?.dataBase64) {
    parts.push({ inlineData: { mimeType: params.media.mimeType, data: params.media.dataBase64 } });
  }
  parts.push({ text: params.userText?.trim() || "(mensagem sem texto)" });

  const result = await chat.sendMessage(parts);
  return result.response.text();
}
