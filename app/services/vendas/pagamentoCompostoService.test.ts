import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getPartesPagamentoVenda,
  somarPagamentosPorMetodo,
} from "./pagamentoCompostoService";

describe("pagamentoCompostoService", () => {
  it("decompõe o valor entre os métodos usados no pagamento composto", () => {
    const partes = getPartesPagamentoVenda({
      metodo: "OUTRO",
      valor: "100",
      detalhes: [
        { metodo: "PIX", valor: "50" },
        { metodo: "DINHEIRO", valor: "50" },
      ],
    });

    assert.deepEqual(
      partes.map((parte) => ({ metodo: parte.metodo, valor: parte.valor.toString() })),
      [
        { metodo: "PIX", valor: "50" },
        { metodo: "DINHEIRO", valor: "50" },
      ],
    );
  });

  it("preserva pagamentos legados com somente um método", () => {
    const totais = somarPagamentosPorMetodo([
      { metodo: "PIX", valor: "25" },
      { metodo: "OUTRO", valor: "100", detalhes: [{ metodo: "DINHEIRO", valor: "100" }] },
    ]);

    assert.equal(totais.get("PIX")?.toString(), "25");
    assert.equal(totais.get("DINHEIRO")?.toString(), "100");
    assert.equal(totais.has("OUTRO"), false);
  });
});
