import type { PrismaClient } from "../../../generated";

// Keep the old file reachable until the new upload AND DB switch succeed.
// CAS avoids silently overwriting another uploader's image reference.
export async function substituirImagemVariante(
  db: Pick<PrismaClient, "produto">,
  contaId: number,
  variante: { id: number; imagem: string | null },
  storage: { upload(): Promise<{ reference: string; url: string }>; remove(reference: string): Promise<unknown> },
) {
  const file = await storage.upload();
  try {
    const changed = await db.produto.updateMany({
      where: { id: variante.id, contaId, imagem: variante.imagem },
      data: { imagem: file.reference },
    });
    if (changed.count !== 1) {
      throw Object.assign(new Error("A imagem foi alterada em outra sessão. Recarregue antes de tentar novamente."), { status: 409, code: "image_conflict" });
    }
  } catch (error) {
    await storage.remove(file.reference).catch(() => undefined);
    throw error;
  }
  if (variante.imagem) await storage.remove(variante.imagem).catch(() => undefined);
  return { id: variante.id, imagem: file.reference, imagemUrl: file.url };
}
