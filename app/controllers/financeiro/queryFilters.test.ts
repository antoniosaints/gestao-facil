import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";

import {
  applyIgnoredParcelaFilter,
  buildParcelaFinanceiroWhere,
  isParcelaConsideradaNoResumo,
  parseFinanceiroFilters,
} from "./queryFilters";

test("interpreta o filtro de lançamentos com parcela ignorada", () => {
  const filters = parseFinanceiroFilters({
    query: { ignorado: "COM_PARCELA_IGNORADA" },
  } as unknown as Request);

  assert.equal(filters.ignorado, "COM_PARCELA_IGNORADA");
  assert.deepEqual(applyIgnoredParcelaFilter({}, filters.ignorado), {
    parcelas: { some: { ignorado: true } },
  });
});

test("filtra lançamentos sem nenhuma parcela ignorada", () => {
  assert.deepEqual(applyIgnoredParcelaFilter({}, "SEM_PARCELA_IGNORADA"), {
    parcelas: { none: { ignorado: true } },
  });
});

test("permite listar parcelas ignoradas sem incluí-las nos resumos", () => {
  const where = buildParcelaFinanceiroWhere(12, {
    tipo: "TODOS",
    search: undefined,
  }, { incluirIgnoradas: true });

  assert.deepEqual(where, { lancamento: { contaId: 12 } });
  assert.equal(isParcelaConsideradaNoResumo({ ignorado: true }), false);
  assert.equal(isParcelaConsideradaNoResumo({ lancamento: { ignorado: true } }), false);
  assert.equal(isParcelaConsideradaNoResumo({ ignorado: false, lancamento: { ignorado: false } }), true);
});
