import type { PrismaClient } from "../../generated";
import { pessoaPatchSchema } from "./adapters/schemas";
import { ModoFacilError } from "./errors";

export async function editarPessoa(db: Pick<PrismaClient, "clientesFornecedores">, contaId: number, id: number, input: unknown) {
  const data = pessoaPatchSchema.parse(input);
  const result = await db.clientesFornecedores.updateMany({ where: { id, contaId }, data });
  if (result.count !== 1) throw new ModoFacilError(404, "person_not_found", "Pessoa não encontrada.");
  return db.clientesFornecedores.findFirst({ where: { id, contaId } });
}
