export class RestaurantTableUnavailableError extends Error {
  constructor() {
    super("A mesa nao esta livre.");
    this.name = "RestaurantTableUnavailableError";
  }
}

export async function claimRestaurantTable(tx: any, contaId: number, mesaId: number) {
  const claimed = await tx.restauranteMesa.updateMany({
    where: { id: mesaId, contaId, ativa: true, status: "LIVRE" },
    data: { status: "OCUPADA", version: { increment: 1 } },
  });
  if (!claimed.count) throw new RestaurantTableUnavailableError();
}
