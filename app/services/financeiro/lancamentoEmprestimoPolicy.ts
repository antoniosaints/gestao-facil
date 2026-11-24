import { AppRequirementError } from "../../utils/appRequirementError";
import { prisma } from "../../utils/prisma";

export async function assertMovimentacaoEditavel(contaId: number, tipo: "lancamento" | "parcela", ids: number | number[]) {
  const validos = (Array.isArray(ids) ? ids : [ids]).filter((id) => Number.isInteger(id) && id > 0 && id <= 2_147_483_647);
  if (!validos.length) return;
  const registro = await prisma.lancamentoFinanceiro.findFirst({
    where: {
      contaId,
      origemSistema: "EMPRESTIMO",
      ...(tipo === "lancamento" ? { id: { in: validos } } : { parcelas: { some: { id: { in: validos } } } }),
    },
    select: { id: true },
  });
  if (registro) {
    throw new AppRequirementError(
      "Esta movimentação está vinculada a um empréstimo. Consulte o registro em Financeiro → Empréstimos.",
      "lancamento_vinculado_emprestimo",
      409,
    );
  }
}
