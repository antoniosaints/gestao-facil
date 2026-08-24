import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calcularFinanceiroOurive,
  dividirRepasseOurives,
} from "./calculoFinanceiroService";

describe("calcularFinanceiroOurive", () => {
  it("separa a base descontando o custo real do material", () => {
    const result = calcularFinanceiroOurive({
      valorBruto: 850,
      custoMaterialLoja: 400,
      outrosCustos: 0,
      percentualLoja: 50,
      percentualOurives: 50,
    });

    assert.deepEqual(result, {
      valorBruto: "850.00",
      custoMaterialLoja: "400.00",
      outrosCustos: "0.00",
      baseDivisao: "450.00",
      percentualLoja: "50.00",
      percentualOurives: "50.00",
      valorLoja: "225.00",
      valorOurives: "225.00",
    });
  });

  it("aceita percentuais configuráveis que somam 100", () => {
    const result = calcularFinanceiroOurive({
      valorBruto: 1000,
      custoMaterialLoja: 100,
      percentualLoja: 60,
      percentualOurives: 40,
    });

    assert.equal(result.baseDivisao, "900.00");
    assert.equal(result.valorLoja, "540.00");
    assert.equal(result.valorOurives, "360.00");
  });

  it("rejeita uma divisão percentual inválida", () => {
    assert.throws(
      () =>
        calcularFinanceiroOurive({
          valorBruto: 100,
          custoMaterialLoja: 0,
          percentualLoja: 60,
          percentualOurives: 50,
        }),
      /ourive_invalid_percentage_split/,
    );
  });

  it("divide o repasse entre os ourives sem perder centavos", () => {
    assert.deepEqual(dividirRepasseOurives("100.00", [3, 1, 2]), [
      { usuarioId: 1, valor: "33.34" },
      { usuarioId: 2, valor: "33.33" },
      { usuarioId: 3, valor: "33.33" },
    ]);
  });
});
