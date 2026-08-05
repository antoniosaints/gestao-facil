import assert from "node:assert/strict";
import test from "node:test";
import { claimRestaurantTable, RestaurantTableUnavailableError } from "./tableSession";

test("reserva a mesa de forma atomica somente quando ela esta livre", async () => {
  const calls: any[] = [];
  const tx = {
    restauranteMesa: {
      updateMany: async (args: any) => {
        calls.push(args);
        return { count: 1 };
      },
    },
  };

  await claimRestaurantTable(tx, 7, 11);
  assert.deepEqual(calls[0].where, { id: 11, contaId: 7, ativa: true, status: "LIVRE" });
});

test("recusa uma segunda abertura concorrente da mesma mesa", async () => {
  const tx = { restauranteMesa: { updateMany: async () => ({ count: 0 }) } };
  await assert.rejects(() => claimRestaurantTable(tx, 7, 11), RestaurantTableUnavailableError);
});
