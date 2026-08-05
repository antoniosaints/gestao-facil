export async function detachRestaurantCommandLinks(
  tx: any,
  contaId: number,
  comandaOperacaoId: number,
) {
  const links = await tx.restauranteSessaoMesaComanda.findMany({
    where: { comandaOperacaoId, Sessao: { contaId } },
    select: { sessaoId: true, Sessao: { select: { mesaId: true, status: true } } },
  });

  await tx.restaurantePedido.updateMany({
    where: { contaId, comandaOperacaoId },
    data: { comandaOperacaoId: null },
  });
  await tx.restauranteSessaoMesaComanda.deleteMany({
    where: { comandaOperacaoId, Sessao: { contaId } },
  });

  const cancelledSessionIds: number[] = [];
  for (const link of links) {
    const remainingCommands = await tx.restauranteSessaoMesaComanda.count({
      where: { sessaoId: link.sessaoId },
    });
    if (remainingCommands || !["ABERTA", "AGUARDANDO_CONTA"].includes(link.Sessao.status)) continue;

    const cancelled = await tx.restauranteSessaoMesa.updateMany({
      where: {
        id: link.sessaoId,
        contaId,
        status: { in: ["ABERTA", "AGUARDANDO_CONTA"] },
      },
      data: { status: "CANCELADA", fechadaAt: new Date() },
    });
    if (!cancelled.count) continue;

    await tx.restauranteMesa.updateMany({
      where: { id: link.Sessao.mesaId, contaId },
      data: { status: "LIMPEZA", version: { increment: 1 } },
    });
    cancelledSessionIds.push(link.sessaoId);
  }

  return { linkedSessionIds: links.map((link: any) => link.sessaoId), cancelledSessionIds };
}
