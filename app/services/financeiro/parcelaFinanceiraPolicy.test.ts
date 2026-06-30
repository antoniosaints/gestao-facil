import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canDeleteParcelaFinanceira,
  resolveLancamentoStatusFromParcelas,
  sumParcelasFinanceiras,
} from "./parcelaFinanceiraPolicy";

describe("parcelaFinanceiraPolicy", () => {
  it("allows deleting only pending installments", () => {
    assert.equal(canDeleteParcelaFinanceira({ pago: false }), true);
    assert.equal(canDeleteParcelaFinanceira({ pago: true }), false);
  });

  it("sums launch totals from installment values", () => {
    const total = sumParcelasFinanceiras([
      { valor: "10.10" },
      { valor: "20.20" },
      { valor: "0.70" },
    ]);

    assert.equal(total.toFixed(2), "31.00");
  });

  it("resolves launch status from installments", () => {
    const today = new Date(2026, 5, 30, 12);

    assert.equal(
      resolveLancamentoStatusFromParcelas([{ pago: false, vencimento: new Date(2026, 6, 1) }], today),
      "PENDENTE",
    );
    assert.equal(
      resolveLancamentoStatusFromParcelas([{ pago: false, vencimento: new Date(2026, 5, 29) }], today),
      "ATRASADO",
    );
    assert.equal(
      resolveLancamentoStatusFromParcelas([
        { pago: true, vencimento: new Date(2026, 5, 29) },
        { pago: false, vencimento: new Date(2026, 6, 1) },
      ], today),
      "PARCIAL",
    );
    assert.equal(
      resolveLancamentoStatusFromParcelas([{ pago: true, vencimento: new Date(2026, 5, 29) }], today),
      "PAGO",
    );
  });
});
