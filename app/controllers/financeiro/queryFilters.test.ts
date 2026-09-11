import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";

import {
  applyIgnoredParcelaFilter,
  buildParcelaFinanceiroWhere,
  isParcelaConsideradaNoResumo,
  matchesTotalParcelasFilter,
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

test("aceita lançamentos parcialmente pagos no filtro de status", () => {
  const filters = parseFinanceiroFilters({
    query: { status: "PARCIAL" },
  } as unknown as Request);

  assert.equal(filters.status, "PARCIAL");
});

test("interpreta os filtros de lançamentos parcelados e recorrentes", () => {
  const parcelados = parseFinanceiroFilters({
    query: { modalidade: "PARCELADOS" },
  } as unknown as Request);
  const recorrentes = parseFinanceiroFilters({
    query: { modalidade: "RECORRENTES" },
  } as unknown as Request);

  assert.equal(parcelados.modalidade, "PARCELADOS");
  assert.equal(recorrentes.modalidade, "RECORRENTES");
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

test("interpreta o intervalo de valor e compara o total das parcelas", () => {
  const filters = parseFinanceiroFilters({
    query: { valorMinimo: "1.250,50", valorMaximo: "2000" },
  } as unknown as Request);

  assert.equal(filters.valorMinimo, 1250.5);
  assert.equal(filters.valorMaximo, 2000);
  assert.equal(matchesTotalParcelasFilter(1250.5, filters.valorMinimo, filters.valorMaximo), true);
  assert.equal(matchesTotalParcelasFilter(2000.01, filters.valorMinimo, filters.valorMaximo), false);
});
