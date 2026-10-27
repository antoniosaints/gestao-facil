import test from "node:test";
import assert from "node:assert/strict";
import { buildLancamentoWhere } from "../../controllers/financeiro/tableFilters";
import {
  getFinanceSummaryScope,
  summarizeMatchingParcels,
} from "../../controllers/financeiro/tableSummaryFilter";
import { parseFinanceiroFilters } from "../../controllers/financeiro/queryFilters";
import type { Request } from "express";

const inicio = new Date("2026-10-01T03:00:00.000Z");
const fim = new Date("2026-11-01T02:59:59.999Z");
const filters = (query = {}) => parseFinanceiroFilters({ query } as Request);
for (const [key, tipo, pago, dateField] of [
  ["RECEBIDO", "RECEITA", true, "dataPagamento"],
  ["PAGO", "DESPESA", true, "dataPagamento"],
  ["A_RECEBER", "RECEITA", false, "vencimento"],
  ["A_PAGAR", "DESPESA", false, "vencimento"],
] as const) {
  test(`card ${key} usa o mesmo tipo, situação da parcela e data do resumo`, () => {
    const scope = getFinanceSummaryScope(key, { inicio, fim })!;
    assert.deepEqual(scope.where, {
      ignorado: false,
      pago,
      [dateField]: { gte: inicio, lte: fim },
    });
    const where = buildLancamentoWhere(
      9,
      filters({
        tipo: "DESPESA",
        status: "PAGO",
        inicio: inicio.toISOString(),
        fim: fim.toISOString(),
        categoriaId: "4",
      }),
      scope,
    );
    assert.equal(where.contaId, 9);
    assert.equal(where.tipo, tipo);
    assert.equal(where.ignorado, false);
    assert.equal(where.categoriaId, 4);
    assert.equal(where.dataLancamento, undefined);
    assert.equal(where.status, undefined);
    assert.deepEqual(where.AND, [{ parcelas: { some: scope.where } }]);
  });
}
test("listagem comum mantém situação e período do lançamento sem filtro de parcelas", () => {
  const where = buildLancamentoWhere(
    8,
    filters({
      tipo: "RECEITA",
      status: "PARCIAL",
      inicio: "2026-10-01T03:00:00Z",
      fim: "2026-10-31T03:00:00Z",
    }),
  );
  assert.equal(where.contaId, 8);
  assert.equal(where.tipo, "RECEITA");
  assert.equal(where.status, "PARCIAL");
  assert.ok(where.dataLancamento);
  assert.equal(where.AND, undefined);
  assert.equal(where.ignorado, undefined);
});
test("valor do card inclui só parcelas correspondentes, inclusive limites do período e centavos", () => {
  const scope = getFinanceSummaryScope("RECEBIDO", { inicio, fim })!;
  const part = {
    ignorado: false,
    pago: true,
    valor: "0.10",
    vencimento: new Date("2020-01-01"),
    dataPagamento: inicio,
  };
  assert.deepEqual(
    summarizeMatchingParcels(
      [
        part,
        { ...part, valor: "0.20", dataPagamento: fim },
        { ...part, valor: "500", ignorado: true },
        { ...part, valor: "500", pago: false },
        { ...part, valor: "500", dataPagamento: new Date(fim.getTime() + 1) },
        { ...part, valor: "500", dataPagamento: null },
      ],
      scope,
    ),
    { valorResumo: 0.3, parcelasResumo: 2 },
  );
});
test("a receber inclui parcela vencida ou futura no período sem depender da situação do lançamento", () => {
  const scope = getFinanceSummaryScope("A_RECEBER", { inicio, fim })!;
  assert.deepEqual(
    summarizeMatchingParcels(
      [
        {
          ignorado: false,
          pago: false,
          valor: "45.90",
          vencimento: inicio,
          dataPagamento: null,
        },
        {
          ignorado: false,
          pago: false,
          valor: "100",
          vencimento: fim,
          dataPagamento: null,
        },
        {
          ignorado: false,
          pago: true,
          valor: "100",
          vencimento: fim,
          dataPagamento: fim,
        },
      ],
      scope,
    ),
    { valorResumo: 145.9, parcelasResumo: 2 },
  );
});
test("valores de query não reconhecidos não ativam filtro de card", () => {
  for (const value of [undefined, "", "TODOS", "__proto__", ["RECEBIDO"], {}])
    assert.equal(getFinanceSummaryScope(value, { inicio, fim }), undefined);
  assert.equal(getFinanceSummaryScope("RECEBIDO", {}), undefined);
});
