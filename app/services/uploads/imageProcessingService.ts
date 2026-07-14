import sharp from "sharp";

export type DownscaleResult = {
  buffer: Buffer;
  contentType: string;
  extension: string;
  width?: number;
  height?: number;
};

export type DownscaleOptions = {
  // Maior dimensão (largura ou altura) permitida. A imagem nunca é ampliada, só reduzida.
  maxDimension?: number;
  // Qualidade de recompressão (1-100). Menor = arquivo menor / menos qualidade.
  quality?: number;
};

// Padrões pensados para imagens de chat/uploads gerais: reduz o tamanho sem inutilizar a imagem.
const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_QUALITY = 70;

function isImageMimeType(mimeType?: string | null): boolean {
  return Boolean(mimeType && mimeType.toLowerCase().startsWith("image/"));
}

// Reescala e recomprime uma imagem para perder qualidade/tamanho, independentemente da dimensão
// original (nunca amplia). Anima­ções (GIF/WebP animado) e SVG são preservados como estão para não
// quebrar. Saída em JPEG (ou PNG quando há transparência) para maximizar a compressão.
export async function downscaleImage(
  input: Buffer,
  mimeType?: string | null,
  options: DownscaleOptions = {},
): Promise<DownscaleResult> {
  const maxDimension = Math.max(1, options.maxDimension ?? DEFAULT_MAX_DIMENSION);
  const quality = Math.min(100, Math.max(1, options.quality ?? DEFAULT_QUALITY));

  // SVG é vetor: reescalar/recomprimir não faz sentido; devolve como está.
  const lower = (mimeType || "").toLowerCase();
  if (lower.includes("svg")) {
    return { buffer: input, contentType: "image/svg+xml", extension: "svg" };
  }

  const image = sharp(input, { failOn: "none", animated: true });
  const metadata = await image.metadata();

  // GIF/WebP animado: manter animação (apenas reescala mantendo os frames), sem trocar de formato.
  if (metadata.pages && metadata.pages > 1) {
    const animated = await sharp(input, { failOn: "none", animated: true })
      .resize({ width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true })
      .toBuffer();
    const ext = lower.includes("webp") ? "webp" : "gif";
    return { buffer: animated, contentType: `image/${ext}`, extension: ext };
  }

  const hasAlpha = Boolean(metadata.hasAlpha);
  const pipeline = image
    .rotate() // respeita orientação EXIF antes de descartar os metadados
    .resize({ width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true });

  // Com transparência, PNG preserva o alfa; sem transparência, JPEG comprime muito mais.
  if (hasAlpha) {
    const buffer = await pipeline.png({ quality, compressionLevel: 9, palette: true }).toBuffer();
    const meta = await sharp(buffer).metadata();
    return { buffer, contentType: "image/png", extension: "png", width: meta.width, height: meta.height };
  }

  const buffer = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
  const meta = await sharp(buffer).metadata();
  return { buffer, contentType: "image/jpeg", extension: "jpg", width: meta.width, height: meta.height };
}

// Reescala apenas se for imagem rasterizada; caso contrário devolve o buffer original intacto.
export async function downscaleIfImage(
  input: Buffer,
  mimeType?: string | null,
  options: DownscaleOptions = {},
): Promise<DownscaleResult | null> {
  if (!isImageMimeType(mimeType)) return null;
  try {
    return await downscaleImage(input, mimeType, options);
  } catch {
    // Se não conseguir decodificar (arquivo corrompido/formato não suportado), não bloqueia o upload.
    return null;
  }
}
