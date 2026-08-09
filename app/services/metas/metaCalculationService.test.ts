import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMetaResumo } from "./metaCalculationService";

describe("buildMetaResumo", () => {
  it("counts financial launches once when a quantity goal filters selected categories", async () => {
    const countCalls: any[] = [];
    const db = {
      lancamentoFinanceiro: {
        count: async ({ where }: any) => {
          countCalls.push(where);
          return 3;
        },
      },
    } as any;

    const resumo = await buildMetaResumo(db, {
      id: 1,
      contaId: 10,
      nome: "Pagamentos de fornecedores",
      tipo: "FINANCEIRO",
      metrica: "QUANTIDADE",
      periodicidade: "PERSONALIZADO",
      valorAlvo: 5,
      dataInicio: new Date(2026, 0, 1),
      dataFim: new Date(2026, 11, 31),
      financeiroTipo: "DESPESA",
      categoriasFinanceiras: [
        { categoriaId: 7, Categoria: { id: 7, nome: "Fornecedores" } },
        { categoriaId: 9, Categoria: { id: 9, nome: "Insumos" } },
      ],
      ativo: true,
    }, new Date(2026, 5, 15));

    assert.equal(resumo.valorAtual, 3);
    assert.deepEqual(resumo.categoriasFinanceiras, [
      { id: 7, nome: "Fornecedores" },
      { id: 9, nome: "Insumos" },
    ]);
    assert.ok(countCalls.length >= 1);
    assert.deepEqual(countCalls[0].categoriaId, { in: [7, 9] });
    assert.deepEqual(countCalls[0].parcelas.some.pago, true);
  });
});
