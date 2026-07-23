import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { endOfDay, startOfDay } from "date-fns";

import { parseDataFiltro } from "./periodo";

describe("parseDataFiltro", () => {
  it("mantém o dia escolhido no fuso do servidor", () => {
    const data = parseDataFiltro("2026-07-01");

    assert.equal(data.getFullYear(), 2026);
    assert.equal(data.getMonth(), 6);
    assert.equal(data.getDate(), 1);
    assert.equal(data.getHours(), 0);
  });

  it("não desloca a janela ao aplicar startOfDay/endOfDay", () => {
    const inicio = startOfDay(parseDataFiltro("2026-07-01"));
    const fim = endOfDay(parseDataFiltro("2026-07-31"));

    assert.equal(inicio.getDate(), 1);
    assert.equal(fim.getDate(), 31);
    assert.equal(fim.getMonth(), 6);
  });

  it("aceita valores que já trazem hora", () => {
    const data = parseDataFiltro("2026-07-01T15:30:00");

    assert.equal(data.getDate(), 1);
    assert.equal(data.getHours(), 15);
  });

  it("devolve data inválida para texto sem sentido", () => {
    assert.ok(Number.isNaN(parseDataFiltro("nao-e-data").getTime()));
  });
});
