import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { env } from "../../utils/dotenv";
import { mainPath } from "../../config/path";

type StorageDriver = "local" | "s3";

type UploadPublicFileParams = {
  key: string;
  body: Buffer;
  contentType?: string;
  cacheControl?: string;
};

const PUBLIC_ROOT = path.join(mainPath, "public");
const DEFAULT_FALLBACK_RELATIVE_PATH = "imgs/logo.png";

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, "");
}

function normalizeEndpoint(value?: string | null) {
  if (!value) return undefined;
  return value.replace(/\/+$/, "");
}

function isAbsoluteUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function looksLikeStorageApiEndpoint(value?: string) {
  if (!value) return false;

  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname.includes("cloudflarestorage.com") ||
      hostname.includes("amazonaws.com") ||
      hostname.includes("digitaloceanspaces.com") ||
      hostname.includes("backblazeb2.com") ||
      hostname.includes("wasabisys.com") ||
      hostname.includes("s3")
    );
  } catch {
    return false;
  }
}

const publicEndpoint = normalizeEndpoint(env.R2_ENDPOINT);
const apiEndpoint = normalizeEndpoint(env.R2_API_ENDPOINT)
  ?? (looksLikeStorageApiEndpoint(publicEndpoint) ? publicEndpoint : undefined);

const s3Client = env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET && apiEndpoint
  ? new S3Client({
      region: "auto",
      endpoint: apiEndpoint,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

export function getUploadDriver(): StorageDriver {
  return s3Client ? "s3" : "local";
}

export function isS3UploadConfigured() {
  return getUploadDriver() === "s3";
}

export function normalizeStorageKey(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";

  if (isAbsoluteUrl(trimmed)) {
    try {
      const url = new URL(trimmed);
      const pathname = decodeURIComponent(url.pathname || "").replace(/^\/+/, "");

      if (publicEndpoint && trimmed.startsWith(publicEndpoint)) {
        return pathname;
      }

      const baseUrl = normalizeEndpoint(env.BASE_URL);
      if (baseUrl && trimmed.startsWith(baseUrl)) {
        return pathname;
      }

      return pathname;
    } catch {
      return trimmed;
    }
  }

  if (trimmed.startsWith("/public/")) {
    return trimmed.replace(/^\/public\//, "");
  }

  if (trimmed.startsWith("public/")) {
    return trimmed.replace(/^public\//, "");
  }

  return trimmed.replace(/^\/+/, "");
}

function getLocalAbsolutePath(reference: string) {
  return path.join(PUBLIC_ROOT, normalizeStorageKey(reference));
}

function getFallbackAbsolutePath(relativePath = DEFAULT_FALLBACK_RELATIVE_PATH) {
  return path.join(PUBLIC_ROOT, trimSlashes(relativePath));
}

export function buildPublicFileUrl(reference: string) {
  if (!reference) return "";
  if (isAbsoluteUrl(reference)) return reference;

  const key = normalizeStorageKey(reference);
  if (!key) return "";

  if (getUploadDriver() === "s3") {
    if (!publicEndpoint) {
      throw new Error("R2_ENDPOINT não está configurado para servir arquivos públicos.");
    }

    return `${publicEndpoint}/${key}`;
  }

  const baseUrl = normalizeEndpoint(env.BASE_URL);
  return `${baseUrl}/${key}`;
}

export async function uploadPublicFile(params: UploadPublicFileParams) {
  const key = normalizeStorageKey(params.key);
  if (!key) {
    throw new Error("A chave do arquivo é obrigatória.");
  }

  if (getUploadDriver() === "s3") {
    await s3Client!.send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: key,
        Body: params.body,
        ContentType: params.contentType,
        CacheControl: params.cacheControl ?? "public, max-age=31536000",
      }),
    );

    const url = buildPublicFileUrl(key);
    return {
      driver: "s3" as const,
      key,
      reference: url,
      url,
    };
  }

  const absolutePath = getLocalAbsolutePath(key);
  await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
  await fsp.writeFile(absolutePath, params.body);

  return {
    driver: "local" as const,
    key,
    reference: key,
    url: buildPublicFileUrl(key),
  };
}

export async function deleteStoredFile(reference?: string | null) {
  if (!reference) return;

  const key = normalizeStorageKey(reference);
  if (!key) return;

  if (getUploadDriver() === "s3") {
    await s3Client!.send(
      new DeleteObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: key,
      }),
    );
    return;
  }

  const absolutePath = getLocalAbsolutePath(key);
  if (fs.existsSync(absolutePath)) {
    await fsp.unlink(absolutePath);
  }
}

export async function readStoredFileBuffer(reference: string) {
  const key = normalizeStorageKey(reference);
  if (!key) {
    throw new Error("Arquivo inválido.");
  }

  if (getUploadDriver() === "s3") {
    const result = await s3Client!.send(
      new GetObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: key,
      }),
    );

    if (!result.Body) {
      throw new Error(`Arquivo não encontrado: ${key}`);
    }

    const bytes = await result.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  return fsp.readFile(getLocalAbsolutePath(key));
}

export async function resolveRenderableImageSource(
  reference?: string | null,
  fallbackRelativePath = DEFAULT_FALLBACK_RELATIVE_PATH,
): Promise<string | Buffer> {
  const fallbackAbsolutePath = getFallbackAbsolutePath(fallbackRelativePath);

  if (!reference) {
    return fallbackAbsolutePath;
  }

  if (getUploadDriver() === "local") {
    const absolutePath = getLocalAbsolutePath(reference);
    return fs.existsSync(absolutePath) ? absolutePath : fallbackAbsolutePath;
  }

  try {
    return await readStoredFileBuffer(reference);
  } catch {
    return fallbackAbsolutePath;
  }
}

export function buildScopedUploadKey(contaId: number, directory: string, fileName: string) {
  const safeDirectory = trimSlashes(directory)
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-zA-Z0-9-_]/g, "-"))
    .join("/");

  const safeFileName = trimSlashes(fileName).replace(/[^a-zA-Z0-9._-]/g, "-");

  return ["uploads", `contas_${contaId}`, safeDirectory, safeFileName]
    .filter(Boolean)
    .join("/");
}
