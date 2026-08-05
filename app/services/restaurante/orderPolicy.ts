type RestaurantPaymentStatus = "PENDENTE" | "PAGO" | "NA_ENTREGA" | "FALHOU" | "ESTORNADO" | "EM_REVISAO";

export function resolveRestaurantCancellation(paymentStatus: RestaurantPaymentStatus) {
  if (paymentStatus === "PAGO" || paymentStatus === "EM_REVISAO") {
    return {
      cancelOrder: false,
      nextPaymentStatus: "EM_REVISAO" as const,
      returnStock: false,
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
