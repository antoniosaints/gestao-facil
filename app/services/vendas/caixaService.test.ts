import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Decimal from "decimal.js";

import {
  buildCaixaPdfFilename,
  calculateCaixaSaldoEsperado,
  canUserEnterCaixa,
  getCaixaMovimentoVendaCleanupWhere,
  getMovementSignedValue,
  getSaldoAdjustmentForDeletedSaleMovements,
  shouldReportCaixaMovimento,
} from "./caixaService";

describe("caixaService", () => {
  it("blocks a user from entering a second active caixa", () => {
    assert.equal(canUserEnterCaixa(null, 10), true);
    assert.equal(canUserEnterCaixa({ caixaId: 10 }, 10), true);
    assert.equal(canUserEnterCaixa({ caixaId: 11 }, 10), false);
  });

  it("applies signed movement values to expected cash balance", () => {
    assert.equal(
      getMovementSignedValue("ABERTURA", new Decimal(100)).toNumber(),
      100
    );
    assert.equal(
      getMovementSignedValue("VENDA", new Decimal(50)).toNumber(),
      50
    );
    assert.equal(
      getMovementSignedValue("REFORCO", new Decimal(20)).toNumber(),
      20
    );
    assert.equal(
      getMovementSignedValue("SANGRIA", new Decimal(30)).toNumber(),
      -30
    );
    assert.equal(
      getMovementSignedValue("ESTORNO", new Decimal(10)).toNumber(),
      -10
    );
  });

  it("calculates expected balance from opening and movements", () => {
    const total = calculateCaixaSaldoEsperado(new Decimal(100), [
      { tipo: "VENDA", valor: new Decimal(75) },
      { tipo: "REFORCO", valor: new Decimal(25) },
      { tipo: "SANGRIA", valor: new Decimal(40) },
    ]);

    assert.equal(total.toNumber(), 160);
  });

  it("scopes sale movement cleanup by conta and venda", () => {
    assert.deepEqual(getCaixaMovimentoVendaCleanupWhere(7, 42), {
      contaId: 7,
      vendaId: 42,
    });
  });

  it("subtracts only cash sale movements when a linked sale is deleted", () => {
    const adjustment = getSaldoAdjustmentForDeletedSaleMovements([
      {
        tipo: "VENDA",
        metodoPagamento: "DINHEIRO",
        valor: new Decimal(80),
      },
      {
        tipo: "VENDA",
        metodoPagamento: "PIX",
        valor: new Decimal(50),
      },
    ]);

    assert.equal(adjustment.toNumber(), -80);
  });

  it("hides orphan sale movements from caixa reports", () => {
    assert.equal(shouldReportCaixaMovimento({ tipo: "VENDA", vendaId: null }), false);
    assert.equal(shouldReportCaixaMovimento({ tipo: "VENDA", vendaId: 42 }), true);
    assert.equal(shouldReportCaixaMovimento({ tipo: "SANGRIA", vendaId: null }), true);
  });

  it("builds a stable caixa pdf filename", () => {
    assert.equal(buildCaixaPdfFilename("CAI_123/ABC"), "caixa-CAI_123-ABC.pdf");
  });
});
