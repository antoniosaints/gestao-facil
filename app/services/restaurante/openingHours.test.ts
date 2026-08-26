import assert from "node:assert/strict";
import test from "node:test";
import { restaurantOnlineOrderingOpen, restaurantOpenNow } from "./openingHours";

const hours = [
  { dia: "SEGUNDA", ativo: true, abertura: "08:00", fechamento: "18:00" },
  { dia: "TERCA", ativo: false, abertura: "08:00", fechamento: "18:00" },
];

test("restaurantOpenNow respeita o horário de São Paulo", () => {
  assert.equal(restaurantOpenNow(hours, new Date("2026-08-10T13:00:00.000Z")).aberto, true);
  assert.equal(restaurantOpenNow(hours, new Date("2026-08-10T22:00:00.000Z")).aberto, false);
  assert.equal(restaurantOpenNow(hours, new Date("2026-08-11T13:00:00.000Z")).aberto, false);
});

test("restaurantOpenNow mantém legados sem horário disponíveis", () => {
  assert.equal(restaurantOpenNow(null).aberto, true);
});

test("restaurantOpenNow aceita atendimento que atravessa a meia-noite", () => {
  const overnight = [{ dia: "SEGUNDA", ativo: true, abertura: "18:00", fechamento: "02:00" }];
  assert.equal(restaurantOpenNow(overnight, new Date("2026-08-10T23:00:00.000Z")).aberto, true);
  assert.equal(restaurantOpenNow(overnight, new Date("2026-08-11T04:00:00.000Z")).aberto, true);
  assert.equal(restaurantOpenNow(overnight, new Date("2026-08-11T05:00:00.000Z")).aberto, false);
});

test("restaurantOnlineOrderingOpen respeita a pausa manual mesmo durante o horário", () => {
  const availability = restaurantOnlineOrderingOpen(
    { horariosJson: hours, aceitarPedidosOnline: false },
    new Date("2026-08-10T13:00:00.000Z"),
  );
  assert.equal(availability.aberto, false);
  assert.equal(availability.mensagem, "Pedidos online estão temporariamente pausados.");
});

test("restaurantOnlineOrderingOpen mantém a validação de horários quando liberado", () => {
  assert.equal(
    restaurantOnlineOrderingOpen({ horariosJson: hours, aceitarPedidosOnline: true }, new Date("2026-08-10T22:00:00.000Z")).aberto,
    false,
  );
});
