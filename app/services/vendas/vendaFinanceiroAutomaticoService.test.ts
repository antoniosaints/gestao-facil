import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deveLancarFinanceiroVenda } from "./vendaFinanceiroAutomaticoService";

describe("deveLancarFinanceiroVenda", () => {
  it("nunca lança para crediário, que já tem fluxo próprio de parcelas", () => {
    assert.equal(
      deveLancarFinanceiroVenda({ parametroAtivo: true, isCrediario: true }),
      false,
    );
    assert.equal(
      deveLancarFinanceiroVenda({ parametroAtivo: false, lancamentoManual: false, isCrediario: true }),
      false,
    );
  });

  it("com o parâmetro ativo lança sempre, ignorando a escolha do modal", () => {
    assert.equal(deveLancarFinanceiroVenda({ parametroAtivo: true }), true);
    assert.equal(
      deveLancarFinanceiroVenda({ parametroAtivo: true, lancamentoManual: true }),
      true,
    );
  });

  it("sem o parâmetro, respeita a escolha feita no faturamento", () => {
    assert.equal(
      deveLancarFinanceiroVenda({ parametroAtivo: false, lancamentoManual: true }),
      false,
    );
    assert.equal(
      deveLancarFinanceiroVenda({ parametroAtivo: false, lancamentoManual: false }),
      true,
    );
  });

  it("trata parâmetro ausente como desativado", () => {
    assert.equal(deveLancarFinanceiroVenda({ lancamentoManual: true }), false);
    assert.equal(deveLancarFinanceiroVenda({ parametroAtivo: null, lancamentoManual: true }), false);
  });
});
