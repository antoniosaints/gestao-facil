type RestaurantPaymentStatus = "PENDENTE" | "PAGO" | "NA_ENTREGA" | "FALHOU" | "ESTORNADO" | "EM_REVISAO";

type CustomerCancellableRestaurantOrder = {
  status: string;
  emPreparoAt?: Date | null;
  tickets?: Array<{ status?: string; iniciadoAt?: Date | null }>;
};

/** O cliente pode desistir até a cozinha efetivamente iniciar o preparo. */
export function canCustomerCancelRestaurantOrder(order: CustomerCancellableRestaurantOrder) {
  if (!['RECEBIDO', 'CONFIRMADO'].includes(order.status) || order.emPreparoAt) return false;
  return !(order.tickets || []).some((ticket) => ticket.iniciadoAt || (ticket.status && ticket.status !== 'PENDENTE'));
}

export function resolveRestaurantCancellation(paymentStatus: RestaurantPaymentStatus) {
  if (paymentStatus === "PAGO" || paymentStatus === "EM_REVISAO") {
    return {
      cancelOrder: true,
      nextPaymentStatus: "EM_REVISAO" as const,
      returnStock: true,
      httpStatus: 202 as const,
    };
  }
  return {
    cancelOrder: true,
    nextPaymentStatus: paymentStatus,
    returnStock: true,
    httpStatus: 200 as const,
  };
}
