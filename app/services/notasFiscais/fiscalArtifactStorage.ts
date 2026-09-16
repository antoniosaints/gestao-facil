import { randomUUID } from "node:crypto";
import { buildScopedUploadKey, deleteStoredFile, readStoredFileBuffer, uploadPublicFile } from "../uploads/fileStorageService";
import { decryptCertificateBuffer, encryptCertificateBuffer } from "./certificateCrypto";

/**
 * O storage usado pela aplicação também serve conteúdo público. Documentos
 * fiscais nunca podem ser publicados: persistimos somente o binário AES-GCM e
 * o endpoint autenticado faz a descriptografia no momento do download.
 */
export async function storeFiscalArtifact(input: { contaId: number; notaFiscalId: number; format: "xml" | "pdf"; bytes: Buffer; previousReference?: string | null }) {
  const key = buildScopedUploadKey(input.contaId, "notas-fiscais/documentos", `${input.notaFiscalId}-${randomUUID()}.${input.format}.enc`);
  const stored = await uploadPublicFile({
    key,
    body: encryptCertificateBuffer(input.bytes),
    contentType: "application/octet-stream",
    cacheControl: "no-store",
  });
  if (input.previousReference && input.previousReference !== stored.reference) {
    await deleteStoredFile(input.previousReference).catch(() => undefined);
  }
  return stored.reference;
}

export async function readFiscalArtifact(reference: string) {
  return decryptCertificateBuffer(await readStoredFileBuffer(reference));
}
