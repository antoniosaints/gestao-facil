import { Prisma } from "../../../generated";
import { prisma } from "../../utils/prisma";
import type { OperationalChargeOriginType } from "./mercadoPagoChargeReference";

type PrismaExecutor = Prisma.TransactionClient | typeof prisma;

export interface OperationalChargeOrigin {
  type: OperationalChargeOriginType;
  id: number;
}

export async function assertOperationalChargeOriginBelongsToAccount(
  executor: PrismaExecutor,
  contaId: number,
  origin?: OperationalChargeOrigin,
) {
  if (!origin) return;

  let exists = false;

  if (origin.type === "venda") {
    exists = Boolean(
      await executor.vendas.findFirst({
        where: { id: origin.id, contaId },
        select: { id: true },
      }),
    );
  } else if (origin.type === "parcela") {
    exists = Boolean(
      await executor.parcelaFinanceiro.findFirst({
        where: { id: origin.id, lancamento: { contaId } },
        select: { id: true },
      }),
    );
  } else if (origin.type === "os") {
    exists = Boolean(
      await executor.ordensServico.findFirst({
        where: { id: origin.id, contaId },
        select: { id: true },
      }),
    );
  } else if (origin.type === "reserva") {
    exists = Boolean(
      await executor.arenaAgendamentos.findFirst({
        where: { id: origin.id, Quadra: { contaId } },
        select: { id: true },
      }),
    );
  } else if (origin.type === "reserva-geral") {
    exists = Boolean(
      await executor.reservaGeral.findFirst({
        where: { id: origin.id, contaId },
        select: { id: true },
      }),
    );
  } else if (origin.type === "restaurante-pedido") {
    exists = Boolean(
      await executor.restaurantePedido.findFirst({
        where: { id: origin.id, contaId },
        select: { id: true },
      }),
    );
  }

  if (!exists) {
    throw new Error("A entidade vinculada à cobrança não pertence a esta conta.");
  }
}
