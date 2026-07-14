import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";

const execFileAsync = promisify(execFile);

// Formatos que a W-API aceita direto para áudio (sem precisar transcodar).
const WAPI_AUDIO_MIMES = ["audio/mpeg", "audio/mp3", "audio/ogg"];

export type TranscodedAudio = {
  buffer: Buffer;
  contentType: string;
  extension: string;
};

// O ffmpeg vem embutido via `ffmpeg-static` (binário por plataforma); pode ser sobrescrito por env.
function resolveFfmpegPath(): string {
  return process.env.FFMPEG_PATH || process.env.WAPI_FFMPEG_PATH || (ffmpegStatic as unknown as string) || "ffmpeg";
}

function cleanMime(value?: string | null): string {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function extensionFromMime(mime: string): string {
  if (mime === "audio/webm") return "webm";
  if (mime === "audio/ogg") return "ogg";
  if (mime === "audio/mpeg" || mime === "audio/mp3") return "mp3";
  if (mime === "audio/wav" || mime === "audio/x-wav") return "wav";
  if (mime === "audio/mp4" || mime === "audio/m4a") return "m4a";
  return "";
}

// Converte um áudio gravado (webm/opus, m4a, wav, etc.) para OGG/Opus — formato aceito pela W-API.
// Se já vier em mp3/ogg, devolve como está (sem reprocessar).
export async function transcodeAudioToOgg(input: Buffer, mimeType?: string | null): Promise<TranscodedAudio> {
  const mime = cleanMime(mimeType);
  if (WAPI_AUDIO_MIMES.includes(mime)) {
    const isOgg = mime === "audio/ogg";
    return { buffer: input, contentType: isOgg ? "audio/ogg" : "audio/mpeg", extension: isOgg ? "ogg" : "mp3" };
  }

  const inputExtension = extensionFromMime(mime) || "audio";
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "gf-audio-"));
  const inputPath = path.join(workDir, `input.${inputExtension}`);
  const outputPath = path.join(workDir, "output.ogg");

  try {
    await fs.writeFile(inputPath, input);
    // -vn (sem vídeo) + Opus 32kbps/48kHz: leve e compatível com nota de voz do WhatsApp.
    await execFileAsync(
      resolveFfmpegPath(),
      ["-y", "-i", inputPath, "-vn", "-acodec", "libopus", "-b:a", "32k", "-ar", "48000", outputPath],
      { windowsHide: true },
    );
    const output = await fs.readFile(outputPath);
    return { buffer: output, contentType: "audio/ogg", extension: "ogg" };
  } catch (cause) {
    const error: any = new Error(
      "Não foi possível converter o áudio gravado para OGG antes do envio. Verifique se o ffmpeg está disponível no servidor.",
    );
    error.status = 500;
    error.cause = cause;
    throw error;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
