import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertReservationTransition,
  calculateReservationPayment,
  canChangePublicReservation,
  normalizeReservationPhone,
  renderReservationTemplate,
} from "./reservaPolicy";

describe("reservaPolicy", () => {
  it("calcula integral, sinal fixo e percentual sem confiar no frontend", () => {
    assert.equal(calculateReservationPayment({ total: 100, policy: "INTEGRAL" }).toNumber(), 100);
    assert.equal(
      calculateReservationPayment({ total: 100, policy: "SINAL_FIXO", fixedDeposit: 25 }).toNumber(),
      25,
    );
    assert.equal(
      calculateReservationPayment({
        total: 99.9,
        policy: "SINAL_PERCENTUAL",
        percentageDeposit: 30,
      }).toNumber(),
      29.97,
    );
  });

  it("bloqueia transições terminais e permite confirmação", () => {
    assert.doesNotThrow(() =>
      assertReservationTransition("AGUARDANDO_PAGAMENTO", "CONFIRMADA"),
    );
    assert.throws(() => assertReservationTransition("CANCELADA", "CONFIRMADA"));
  });

  it("renderiza somente variáveis conhecidas", () => {
    assert.equal(
      renderReservationTemplate("Olá {cliente}, sua reserva de {servico}.", {
        cliente: "Ana",
        servico: "Corte",
      }),
      "Olá Ana, sua reserva de Corte.",
    );
    assert.throws(() => renderReservationTemplate("{segredo}", {}));
  });

  it("normaliza telefone e respeita a antecedência pública", () => {
    assert.equal(normalizeReservationPhone("(11) 99999-0000"), "5511999990000");
    const now = new Date("2026-07-28T10:00:00-03:00");
    assert.equal(
      canChangePublicReservation(new Date("2026-07-29T11:00:00-03:00"), 24, now),
      true,
    );
    assert.equal(
      canChangePublicReservation(new Date("2026-07-29T09:00:00-03:00"), 24, now),
      false,
    );
  });
});
