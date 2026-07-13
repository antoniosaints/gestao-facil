import crypto from "crypto";
import axios from "axios";

// Descriptografia de mídia do WhatsApp (mesmo esquema do Signal usado pelo WhatsApp):
// a W-API entrega no webhook a URL de um arquivo `.enc` (criptografado) + a `mediaKey`.
// Para exibir a mídia é preciso baixar o `.enc`, derivar as chaves com HKDF-SHA256 e
// decifrar com AES-256-CBC, validando o HMAC-SHA256 anexado ao final do arquivo.
// Referência de implementação: https://github.com/antoniosaints/w-api-manager (server/media.js).

type MediaKind = "image" | "sticker" | "video" | "audio" | "document" | "application";

const MEDIA_INFO: Record<string, string> = {
  image: "WhatsApp Image Keys",
  sticker: "WhatsApp Image Keys",
  video: "WhatsApp Video Keys",
  audio: "WhatsApp Audio Keys",
  document: "WhatsApp Document Keys",
  application: "WhatsApp Document Keys",
};

const WHATSAPP_MEDIA_HOST = "https://mmg.whatsapp.net";

export interface WhatsAppMediaInfo {
  type: MediaKind;
  url: string;
  directPath?: string;
  mimetype: string;
  mediaKey: string;
  fileName: string;
  size: number;
}

export interface DecryptedWhatsAppMedia {
  mimetype: string;
  fileName: string;
  buffer: Buffer;
}

export class WhatsAppMediaError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function extractWhatsAppMediaInfo(raw: any): WhatsAppMediaInfo | null {
  const found = findMediaMessage(raw);
  const media = found?.media;
  const type = (found?.type || inferMediaType(media)) as MediaKind;
  const url = resolveMediaUrl(media, type);
  if (!media || !url || !media.mediaKey) return null;

  return {
    type,
    url,
    ...(media.directPath ? { directPath: media.directPath } : {}),
    mimetype: media.mimetype || media.mimeType || defaultMimetype(type),
    mediaKey: media.mediaKey || "",
    fileName: media.fileName || media.filename || media.title || "",
    size: toNumber(media.fileLength ?? media.fileSize ?? media.size),
  };
}

export async function downloadAndDecryptWhatsAppMedia(raw: any): Promise<DecryptedWhatsAppMedia> {
  const info = extractWhatsAppMediaInfo(raw);
  if (!info) {
    throw new WhatsAppMediaError("Mídia não encontrada no payload da mensagem.", 404);
  }

  let encrypted: Buffer;
  try {
    const response = await axios.get<ArrayBuffer>(info.url, {
      responseType: "arraybuffer",
      timeout: 25000,
    });
    encrypted = Buffer.from(response.data);
  } catch (error: any) {
    const status = error?.response?.status;
    throw new WhatsAppMediaError(`Falha ao baixar a mídia do WhatsApp${status ? ` (${status})` : ""}.`, 502);
  }

  return {
    mimetype: info.mimetype,
    fileName: info.fileName,
    buffer: decryptWhatsAppMedia(encrypted, info.mediaKey, info.mimetype),
  };
}

export function decryptWhatsAppMedia(encryptedPayload: Buffer, mediaKey: string | Buffer, mimetype = "image/jpeg"): Buffer {
  const encrypted = Buffer.from(encryptedPayload);
  const key = Buffer.isBuffer(mediaKey) ? mediaKey : Buffer.from(mediaKey, "base64");
  const mediaType = normalizeMediaTypeFromMime(mimetype);
  const info = MEDIA_INFO[mediaType] || MEDIA_INFO.image;

  // HKDF-SHA256: salt = 32 bytes zerados, info = "WhatsApp <Tipo> Keys", tamanho = 112 bytes.
  const expanded = Buffer.from(crypto.hkdfSync("sha256", key, Buffer.alloc(32), Buffer.from(info), 112));
  const iv = expanded.subarray(0, 16);
  const cipherKey = expanded.subarray(16, 48);
  const macKey = expanded.subarray(48, 80);

  const ciphertext = encrypted.subarray(0, -10);
  const mac = encrypted.subarray(-10);
  const expectedMac = crypto
    .createHmac("sha256", macKey)
    .update(Buffer.concat([iv, ciphertext]))
    .digest()
    .subarray(0, 10);

  if (mac.length === 10 && !crypto.timingSafeEqual(mac, expectedMac)) {
    throw new WhatsAppMediaError("Assinatura da mídia inválida.", 422);
  }

  const decipher = crypto.createDecipheriv("aes-256-cbc", cipherKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function findMediaMessage(raw: any): { type: MediaKind; media: any } | null {
  if (!raw || typeof raw !== "object") return null;
  const roots = [raw.data, raw.msgContent, raw.message, raw].filter((item) => item && typeof item === "object");

  for (const root of roots) {
    const content = root.msgContent || root.message || root;
    const associated = content.associatedChildMessage?.message || {};
    const candidates: Array<[MediaKind, any]> = [
      ["image", content.imageMessage || content.image || associated.imageMessage || associated.image],
      ["sticker", content.stickerMessage || content.sticker || associated.stickerMessage || associated.sticker],
      ["audio", content.audioMessage || content.audio || associated.audioMessage || associated.audio],
      ["video", content.videoMessage || content.video || associated.videoMessage || associated.video],
      ["document", content.documentMessage || content.document || associated.documentMessage || associated.document],
    ];

    for (const [type, media] of candidates) {
      if (media && typeof media === "object") {
        return { type, media };
      }
    }
  }

  return null;
}

function resolveMediaUrl(media: any, type = ""): string {
  if (!media || typeof media !== "object") return "";
  const url = [media.URL, media.url, media.mediaUrl, media.link].find(
    (value) => typeof value === "string" && value.trim(),
  ) as string | undefined;
  if (url && !isGenericWhatsAppUrl(url, type)) return url;
  return buildWhatsAppDirectPathUrl(media.directPath) || url || "";
}

function buildWhatsAppDirectPathUrl(value: any): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const path = value.trim();
  if (path.startsWith("http")) return path;
  return `${WHATSAPP_MEDIA_HOST}${path.startsWith("/") ? path : `/${path}`}`;
}

function isGenericWhatsAppUrl(value: string, type = ""): boolean {
  try {
    const url = new URL(value);
    const isRoot = url.pathname === "" || url.pathname === "/";
    if (!isRoot) return false;
    if (url.hostname === "web.whatsapp.net") return true;
    return type === "sticker" && url.hostname === "a.whatsapp.net";
  } catch {
    return false;
  }
}

function inferMediaType(media: any): MediaKind {
  const mime = String(media?.mimetype || media?.mimeType || "").split(";")[0].trim();
  return normalizeMediaTypeFromMime(mime) as MediaKind;
}

function normalizeMediaTypeFromMime(mimetype: string): string {
  const primary = String(mimetype || "").split(";")[0].split("/")[0].trim().toLowerCase();
  if (primary === "image") return "image";
  if (primary === "audio") return "audio";
  if (primary === "video") return "video";
  if (primary === "application" || primary === "text") return "document";
  return primary || "image";
}

function defaultMimetype(type: string): string {
  if (type === "audio") return "audio/ogg";
  if (type === "video") return "video/mp4";
  if (type === "document") return "application/octet-stream";
  return "image/jpeg";
}

function toNumber(value: any): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
