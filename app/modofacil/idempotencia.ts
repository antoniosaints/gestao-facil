import { createHash } from "node:crypto";
import { Prisma, PrismaClient } from "../../generated";
import { ModoFacilError } from "./errors";

export async function executarUmaVez(
  db: PrismaClient,
  contaId: number,
  chave: string,
  payload: unknown,
  work: (tx: Prisma.TransactionClient) => Promise<unknown>,
) {
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const where = { contaId_chave: { contaId, chave } };
  const replay = async () => {
    const row = await db.modoFacilOperacao.findUnique({ where });
    if (!row) return null;
    if (row.hash !== hash) throw new ModoFacilError(409, "idempotency_key_reused", "Chave já utilizada com outros dados.");
    return { data: row.resultado, replay: true };
  };
  const previous = await replay();
  if (previous) return previous;
  try {
    return await db.$transaction(async tx => {
      // Reserve the key before domain writes. Duplicate concurrent inserts wait
      // for commit or rollback; no partial product survives a failed transaction.
      await tx.modoFacilOperacao.create({ data: { contaId, chave, hash, resultado: Prisma.JsonNull } });
      const data = JSON.parse(JSON.stringify(await work(tx))) as Prisma.InputJsonValue;
      await tx.modoFacilOperacao.update({ where, data: { resultado: data } });
      return { data, replay: false };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const previous = await replay();
      if (previous) return previous;
    }
    throw error;
  }
}
