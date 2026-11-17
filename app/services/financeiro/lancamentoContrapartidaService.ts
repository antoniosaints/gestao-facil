import type { PrismaClient } from "../../../generated/client";
import { executarUmaVez } from "../../modofacil/idempotencia";
import { lancamentoContrapartidaSchema } from "../../schemas/lancamentoContrapartida";
import { requireContaFinanceiraPadrao } from "./contaFinanceiraPadraoService";
import { criarLancamentoFinanceiro } from "./lancamentoService";

export class ContrapartidaInputError extends Error {
  status = 422;
  code = "contrapartida_invalid_input";
}

// The existing idempotency reservation and both financial writes share one DB transaction.
// No writes, notifications or recurrence configurations survive a failed counterpart.
export async function criarLancamentoComContrapartida(
  db: PrismaClient,
  contaId: number,
  input: unknown,
  create: typeof criarLancamentoFinanceiro = criarLancamentoFinanceiro,
) {
  const { chaveOperacao, ...payload } =
    lancamentoContrapartidaSchema.parse(input);
  try {
    return await executarUmaVez(
      db,
      contaId,
      chaveOperacao,
      { operacao: "financeiro-receita-despesa", ...payload },
      async (tx) => {
        const categoria = await tx.categoriaFinanceiro.findFirst({
          where: { id: payload.categoriaId, contaId },
          select: { id: true },
        });
        if (!categoria)
          throw new ContrapartidaInputError(
            "A categoria não pertence à sua conta ou não está disponível.",
          );
        if (payload.clienteId) {
          const cliente = await tx.clientesFornecedores.findFirst({
            where: { id: payload.clienteId, contaId },
            select: { id: true },
          });
          if (!cliente)
            throw new ContrapartidaInputError(
              "O cliente/fornecedor não pertence à sua conta ou não está disponível.",
            );
        }
        const contasFinanceiroId = await requireContaFinanceiraPadrao(
          tx,
          contaId,
          payload.contasFinanceiroId,
        );
        const comum = { ...payload, contasFinanceiroId };
        const receita = await create(
          tx,
          contaId,
          { ...comum, tipo: "RECEITA" },
          { skipNotification: true },
        );
        const despesa = await create(
          tx,
          contaId,
          { ...comum, tipo: "DESPESA", notificarClienteVencimento: false },
          { skipNotification: true },
        );
        return {
          id: payload.tipo === "RECEITA" ? receita.id : despesa.id,
          receitaId: receita.id,
          despesaId: despesa.id,
          valorTotal: receita.valorTotal.toFixed(2),
        };
      },
      { maxWait: 10000, timeout: 30000 },
    );
  } catch (error) {
    if (error instanceof Error && error.constructor === Error)
      throw new ContrapartidaInputError(error.message);
    throw error;
  }
}
