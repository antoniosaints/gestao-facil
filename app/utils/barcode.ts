import bwipjs from "bwip-js";

export type BarcodeSymbology = "code128" | "ean13";

export interface BarcodeImageOptions {
  symbology?: BarcodeSymbology;
  scale?: number;
  height?: number;
  includetext?: boolean;
}

// EAN-13 exige 12 ou 13 digitos numericos (o 13o e o digito verificador).
function isValidEan13(code: string): boolean {
  return /^\d{12,13}$/.test(code);
}

export async function generateBarcodeImage(
  code: string,
  options: BarcodeImageOptions = {}
): Promise<Buffer> {
  let bcid: string = options.symbology ?? "code128";

  // Se pediram ean13 mas o codigo nao e valido, cai para code128 (nunca quebra a geracao).
  if (bcid === "ean13" && !isValidEan13(code)) {
    bcid = "code128";
  }

  return new Promise((resolve, reject) => {
    bwipjs.toBuffer(
      {
        bcid,
        text: code,
        scale: options.scale ?? 3,
        height: options.height ?? 10,
        includetext: options.includetext ?? true,
        textxalign: "center",
      },
      (err, png) => {
        if (err) reject(err);
        else resolve(png);
      }
    );
  });
}
