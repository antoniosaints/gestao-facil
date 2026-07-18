import { prisma } from "../../utils/prisma";

/**
 * Faz o faturamento automático de uma Ordem de Serviço quando a cobrança
 * vinculada (ordemServicoId) é paga via gateway.
 *
 * Espelha o efeito do faturamento manual (status -> FATURADA) de forma
 * idempotente, para suportar reenvios/duplicações de webhook.
 *
 * Diferente do faturamento manual (efetivarOrdemServico), este fluxo NÃO cria
 * um novo lançamento financeiro: aqui a própria cobrança paga já é o registro
 * financeiro do recebimento. No fluxo manual o sistema cancela a cobrança
 * pendente e gera o lançamento no lugar; criar um lançamento aqui duplicaria o
 * valor recebido.
 *
 * Não fatura OS já faturadas (idempotência) nem canceladas (não "ressuscita"
 * uma OS cancelada por causa de um pagamento tardio).
 */
export async function faturarOrdemServicoPorPagamento(
  ordemServicoId: number,
  contaId: number,
) {
  const ordem = await prisma.ordensServico.findFirst({
    where: { id: ordemServicoId, contaId },
    select: { id: true, status: true },
  });

  if (!ordem) return { faturada: false, motivo: "nao-encontrada" as const };
  if (ordem.status === "FATURADA") {
    return { faturada: false, motivo: "ja-faturada" as const };
  }
  if (ordem.status === "CANCELADA") {
    return { faturada: false, motivo: "cancelada" as const };
  }

  // Guarda de concorrência: só efetiva se ainda não estiver faturada/cancelada,
  // evitando corrida entre duas entregas simultâneas do webhook.
  const resultado = await prisma.ordensServico.updateMany({
    where: {
      id: ordemServicoId,
      contaId,
      status: { notIn: ["FATURADA", "CANCELADA"] },
    },
    data: { status: "FATURADA" },
  });

  return { faturada: resultado.count > 0 };
}
