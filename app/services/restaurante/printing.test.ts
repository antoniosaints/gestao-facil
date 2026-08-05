import assert from "node:assert/strict";
import test from "node:test";
import { decidePrintFailure, renderProductionTicket } from "./printing";

test("repete antes de esgotar tentativas e usa fallback depois", () => {
  assert.deepEqual(decidePrintFailure({ attempts: 1, maxAttempts: 3, stationId: 1, fallbackStationId: 2 }), { action: "RETRY" });
  assert.deepEqual(decidePrintFailure({ attempts: 3, maxAttempts: 3, stationId: 1, fallbackStationId: 2 }), { action: "FALLBACK", stationId: 2 });
  assert.deepEqual(decidePrintFailure({ attempts: 3, maxAttempts: 3, stationId: 1 }), { action: "FAIL" });
});

test("gera ticket termico com identificador deduplicavel e observacoes", () => {
  const output = renderProductionTicket({
    uid: "job-123",
    paper: "58mm",
    pointName: "Cozinha",
    orderCode: "R123",
    origin: "MESA",
    tableName: "Mesa 4",
    orderNote: "Sem pressa",
    createdAt: new Date("2026-08-04T12:00:00-03:00"),
    items: [{ quantity: 2, name: "Hamburguer", selections: [{ nome: "Bacon" }], note: "Sem cebola" }],
  });
  assert.match(output, /2x Hamburguer/);
  assert.match(output, /Bacon/);
  assert.match(output, /SEM CEBOLA/i);
  assert.match(output, /JOB job-123/);
});
