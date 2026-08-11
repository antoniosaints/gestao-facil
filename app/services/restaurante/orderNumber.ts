type RestauranteConfigSequenceClient = {
  restauranteConfig: {
    update: (args: {
      where: { contaId: number };
      data: { proximoNumeroPedido: { increment: number } };
      select: { proximoNumeroPedido: true };
    }) => Promise<{ proximoNumeroPedido: number }>;
  };
};

/** Reserva o próximo número público de pedido da conta na transação atual. */
export async function reservarNumeroPedido(
  tx: RestauranteConfigSequenceClient,
  contaId: number,
): Promise<string> {
  const config = await tx.restauranteConfig.update({
    where: { contaId },
    data: { proximoNumeroPedido: { increment: 1 } },
    select: { proximoNumeroPedido: true },
  });

  return String(config.proximoNumeroPedido - 1);
}
