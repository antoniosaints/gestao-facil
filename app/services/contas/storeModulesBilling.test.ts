import assert from "node:assert/strict";
import Decimal from "decimal.js";
import { addDays, startOfDay } from "date-fns";
import { describe, it } from "node:test";

import { calculateModuleImmediateCharge } from "./storeModulesService";

// Constrói um vencimento a N dias de hoje (início do dia, determinístico).
function vencimentoEm(dias: number) {
  return startOfDay(addDays(new Date(), dias));
}

describe("calculateModuleImmediateCharge (valor proporcional)", () => {
  it("cobra o valor cheio para um ciclo completo (30 dias)", () => {
    assert.equal(calculateModuleImmediateCharge(30, vencimentoEm(30), "PROPORCIONAL").toNumber(), 30);
  });

  it("cobra metade para 15 dias restantes", () => {
    assert.equal(calculateModuleImmediateCharge(30, vencimentoEm(15), "PROPORCIONAL").toNumber(), 15);
  });

  it("cobra uma diária para 1 dia restante", () => {
    assert.equal(calculateModuleImmediateCharge(30, vencimentoEm(1), "PROPORCIONAL").toNumber(), 1);
  });

  it("não cobra nada quando o vencimento é hoje (0 dias restantes)", () => {
    assert.equal(calculateModuleImmediateCharge(30, vencimentoEm(0), "PROPORCIONAL").toNumber(), 0);
  });

  it("não cobra nada quando o vencimento já passou", () => {
    assert.equal(calculateModuleImmediateCharge(30, vencimentoEm(-5), "PROPORCIONAL").toNumber(), 0);
  });

  it("limita a no máximo uma mensalidade cheia quando há mais de 30 dias", () => {
    assert.equal(calculateModuleImmediateCharge(30, vencimentoEm(45), "PROPORCIONAL").toNumber(), 30);
  });

  it("no modo MENSAL cobra sempre o valor cheio", () => {
    assert.equal(calculateModuleImmediateCharge(30, vencimentoEm(10), "MENSAL").toNumber(), 30);
    assert.equal(calculateModuleImmediateCharge(30, vencimentoEm(0), "MENSAL").toNumber(), 30);
  });

  it("arredonda a 2 casas (half up)", () => {
    // 49,90 * 10 / 30 = 16,6333... -> 16,63
    assert.equal(calculateModuleImmediateCharge(49.9, vencimentoEm(10), "PROPORCIONAL").toNumber(), 16.63);
  });

  it("aceita Decimal como preço", () => {
    // 70 * 6 / 30 = 14
    assert.equal(calculateModuleImmediateCharge(new Decimal("70"), vencimentoEm(6), "PROPORCIONAL").toNumber(), 14);
  });

  it("preço zero resulta em zero", () => {
    assert.equal(calculateModuleImmediateCharge(0, vencimentoEm(15), "PROPORCIONAL").toNumber(), 0);
  });
});
