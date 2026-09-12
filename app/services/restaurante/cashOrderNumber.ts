/**
 * O número operacional do pedido pertence ao turno de caixa, não ao registro do pedido.
 * Ele é calculado pela ordem de criação dentro da mesma sessão e nunca é persistido.
 */
type CashOrderRef = {
  id: number
  restauranteCaixaId?: number | null
}

type RestaurantOrderClient = {
  restaurantePedido: {
    findMany: (args: any) => Promise<Array<{ id: number; restauranteCaixaId: number | null }>>
  }
}

export async function getRestaurantCashOrderNumbers(
  db: RestaurantOrderClient,
  orders: CashOrderRef[],
): Promise<Map<number, number>> {
  const cashIds = [...new Set(orders.map((order) => order.restauranteCaixaId).filter((id): id is number => Boolean(id)))]
  if (!cashIds.length) return new Map()

  const cashOrders = await db.restaurantePedido.findMany({
    where: { restauranteCaixaId: { in: cashIds } },
    select: { id: true, restauranteCaixaId: true },
    orderBy: { id: 'asc' },
  })

  const counters = new Map<number, number>()
  const numbers = new Map<number, number>()
  for (const order of cashOrders) {
    if (!order.restauranteCaixaId) continue
    const next = (counters.get(order.restauranteCaixaId) || 0) + 1
    counters.set(order.restauranteCaixaId, next)
    numbers.set(order.id, next)
  }
  return numbers
}

/** Entrega o mesmo payload do pedido, trocando somente o código exibido pelo número do caixa. */
export async function withRestaurantCashOrderNumber<T extends CashOrderRef>(
  db: RestaurantOrderClient,
  orders: T[],
): Promise<Array<T & { numeroPedido?: number; codigo: string }>> {
  const numbers = await getRestaurantCashOrderNumbers(db, orders)
  return orders.map((order: any) => {
    const numeroPedido = numbers.get(order.id)
    return numeroPedido ? { ...order, numeroPedido, codigo: String(numeroPedido) } : order
  })
}

export async function getRestaurantCashOrderNumber(
  db: RestaurantOrderClient,
  order: CashOrderRef,
): Promise<string> {
  const numbers = await getRestaurantCashOrderNumbers(db, [order])
  return String(numbers.get(order.id) || order.id)
}
