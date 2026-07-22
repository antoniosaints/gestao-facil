import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canDeleteParcelaFinanceira,
  MOTIVO_APENAS_PENDENTES,
  MOTIVO_COM_COBRANCA,
  MOTIVO_JA_EFETIVADA,
  MOTIVO_MINIMO_UMA_PARCELA,
  MOTIVO_NAO_EFETIVADA,
  resolveLancamentoStatusFromParcelas,
  separarParcelasParaEfetivar,
  separarParcelasParaEstornar,
  separarParcelasParaExcluir,
  sumParcelasFinanceiras,
  type ParcelaLoteInput,
} from "./parcelaFinanceiraPolicy";

function parcela(overrides: Partial<ParcelaLoteInput> & { id: number }): ParcelaLoteInput {
  return {
    numero: overrides.id,
    pago: false,
    lancamentoId: 1,
    temCobranca: false,
    ...overrides,
  };
}

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

describe("separarParcelasParaEfetivar", () => {
  it("aplica somente nas pendentes e ignora as já pagas", () => {
    const resultado = separarParcelasParaEfetivar([
      parcela({ id: 1, pago: true }),
      parcela({ id: 2 }),
      parcela({ id: 3 }),
    ]);

    assert.deepEqual(resultado.aplicar, [2, 3]);
    assert.deepEqual(resultado.ignoradas, [{ id: 1, motivo: MOTIVO_JA_EFETIVADA }]);
  });
});

describe("separarParcelasParaEstornar", () => {
  it("aplica somente nas pagas e ignora as pendentes", () => {
    const resultado = separarParcelasParaEstornar([
      parcela({ id: 1, pago: true }),
      parcela({ id: 2 }),
    ]);

    assert.deepEqual(resultado.aplicar, [1]);
    assert.deepEqual(resultado.ignoradas, [{ id: 2, motivo: MOTIVO_NAO_EFETIVADA }]);
  });
});

describe("separarParcelasParaExcluir", () => {
  it("ignora parcelas pagas e com cobrança vinculada", () => {
    const resultado = separarParcelasParaExcluir(
      [parcela({ id: 1, pago: true }), parcela({ id: 2, temCobranca: true }), parcela({ id: 3 })],
      { 1: 5 },
    );

    assert.deepEqual(resultado.aplicar, [3]);
    assert.deepEqual(resultado.ignoradas, [
      { id: 1, motivo: MOTIVO_APENAS_PENDENTES },
      { id: 2, motivo: MOTIVO_COM_COBRANCA },
    ]);
  });

  it("preserva a parcela de menor número quando todas foram selecionadas", () => {
    const resultado = separarParcelasParaExcluir(
      [
        parcela({ id: 30, numero: 3 }),
        parcela({ id: 10, numero: 1 }),
        parcela({ id: 20, numero: 2 }),
      ],
      { 1: 3 },
    );

    assert.deepEqual(resultado.aplicar, [20, 30]);
    assert.deepEqual(resultado.ignoradas, [{ id: 10, motivo: MOTIVO_MINIMO_UMA_PARCELA }]);
  });

  it("não preserva nada quando o lançamento mantém outras parcelas fora da seleção", () => {
    const resultado = separarParcelasParaExcluir(
      [parcela({ id: 2, numero: 2 }), parcela({ id: 3, numero: 3 })],
      { 1: 3 },
    );

    assert.deepEqual(resultado.aplicar, [2, 3]);
    assert.deepEqual(resultado.ignoradas, []);
  });

  it("aplica o mínimo de uma parcela por lançamento, não globalmente", () => {
    const resultado = separarParcelasParaExcluir(
      [
        parcela({ id: 1, numero: 1, lancamentoId: 10 }),
        parcela({ id: 2, numero: 2, lancamentoId: 10 }),
        parcela({ id: 3, numero: 1, lancamentoId: 20 }),
        parcela({ id: 4, numero: 2, lancamentoId: 20 }),
      ],
      { 10: 2, 20: 4 },
    );

    assert.deepEqual(resultado.aplicar, [2, 3, 4]);
    assert.deepEqual(resultado.ignoradas, [{ id: 1, motivo: MOTIVO_MINIMO_UMA_PARCELA }]);
  });

  it("considera a seleção como total do lançamento quando o total não é informado", () => {
    const resultado = separarParcelasParaExcluir([parcela({ id: 1 }), parcela({ id: 2 })], {});

    assert.deepEqual(resultado.aplicar, [2]);
    assert.deepEqual(resultado.ignoradas, [{ id: 1, motivo: MOTIVO_MINIMO_UMA_PARCELA }]);
  });
});
