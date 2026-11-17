import { z } from "zod";
import type { Content } from "@google/generative-ai";

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const AUDIO_MIME_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
  "audio/aac",
] as const;
const attachment = (types: readonly string[], bytes: number) =>
  z.object({
    data: z
      .string()
      .min(4)
      .max(Math.ceil(bytes / 3) * 4)
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
        "Arquivo base64 inválido",
      )
      .refine(
        (data) => Buffer.byteLength(data, "base64") <= bytes,
        "Arquivo muito grande",
      ),
    mimeType: z
      .string()
      .transform((value) => value.split(";")[0].trim().toLowerCase())
      .refine(
        (value) => types.includes(value),
        "Formato de arquivo não suportado",
      ),
    name: z.string().max(180).optional(),
  });
export const coreIaChatSchema = z
  .object({
    prompt: z.string().trim().max(8000).default(""),
    history: z
      .array(
        z.object({
          role: z.enum(["user", "model"]),
          parts: z
            .array(z.object({ text: z.string().max(12000) }))
            .min(1)
            .max(4),
        }),
      )
      .max(24)
      .default([])
      .refine(
        (items) => JSON.stringify(items).length <= 48000,
        "Histórico muito longo; inicie uma nova conversa",
      ),
    image: attachment(
      ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
      4 * 1024 * 1024,
    ).optional(),
    audio: attachment(AUDIO_MIME_TYPES, MAX_AUDIO_BYTES).optional(),
    confirmation: z
      .object({
        id: z.string().uuid(),
        decision: z.enum(["confirm", "cancel"]),
      })
      .strict()
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.prompt && !value.image && !value.audio && !value.confirmation)
      ctx.addIssue({
        code: "custom",
        message: "Escreva uma mensagem ou envie um áudio ou imagem",
      });
    if (value.audio && value.image)
      ctx.addIssue({ code: "custom", message: "Envie um anexo por mensagem" });
    if (value.confirmation && (value.prompt || value.image || value.audio))
      ctx.addIssue({
        code: "custom",
        message: "Confirme a operação separadamente",
      });
  });

// Function calls/results and binary attachments are never accepted back from a browser.
export function textOnlyHistory(history: Content[]): Content[] {
  const cleaned: Content[] = [];
  for (const item of history) {
    const text = item.parts
      .map((part) => ("text" in part ? part.text : ""))
      .filter(Boolean)
      .join("\n")
      .slice(0, 6000);
    if (!text || !["user", "model"].includes(item.role)) continue;
    const last = cleaned[cleaned.length - 1];
    if (last?.role === item.role)
      last.parts = [{ text: `${last.parts[0].text}\n${text}`.slice(-6000) }];
    else cleaned.push({ role: item.role, parts: [{ text }] });
  }
  while (cleaned.length && cleaned[0].role !== "user") cleaned.shift();
  while (cleaned.length > 16 || JSON.stringify(cleaned).length > 40000)
    cleaned.splice(0, 2);
  return cleaned;
}
