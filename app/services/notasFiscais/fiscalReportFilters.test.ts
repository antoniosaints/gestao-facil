import assert from "node:assert/strict";
import { test } from "node:test";
import { fiscalReportFilters } from "./fiscalReportFilters";

test("filtra os três tipos e inclui o dia final inteiro no período", () => {
  const result = fiscalReportFilters({ tipo: "NFSE", status: "REJEITADA", ambiente: "HOMOLOGACAO", inicio: "2026-09-28", fim: "2026-09-29" });
  assert.equal(result.error, undefined);
  assert.equal(result.where.tipo, "NFSE");
  assert.equal(result.where.status, "REJEITADA");
  assert.equal(result.where.ambiente, "HOMOLOGACAO");
  assert.equal((result.where.criadoEm as { gte: Date }).gte.toISOString(), "2026-09-28T03:00:00.000Z");
  assert.equal((result.where.criadoEm as { lt: Date }).lt.toISOString(), "2026-09-30T03:00:00.000Z");
});

test("rejeita período invertido e mantém busca por número", () => {
  assert.match(fiscalReportFilters({ inicio: "2026-09-30", fim: "2026-09-28" }).error || "", /período/);
  assert.match(fiscalReportFilters({ inicio: "2026-02-30" }).error || "", /período/);
  const result = fiscalReportFilters({ tipo: "TODOS", search: "12345" });
  assert.equal(result.where.tipo, undefined);
  assert.ok(Array.isArray(result.where.OR));
  assert.ok((result.where.OR as Array<{ id?: number }>).some((part) => part.id === 12345));
});
