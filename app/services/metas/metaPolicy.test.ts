import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateMetaProgress,
  canManageMetas,
  getMetaHistoryWindows,
  getMetaPeriodWindow,
} from "./metaPolicy";

function localDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

describe("metaPolicy", () => {
  it("allows only admin and root to manage goals", () => {
    assert.equal(canManageMetas("root"), true);
    assert.equal(canManageMetas("admin"), true);
    assert.equal(canManageMetas("gerente"), false);
    assert.equal(canManageMetas("usuario"), false);
  });

  it("calculates capped progress and remaining value", () => {
    const partial = calculateMetaProgress({ valorAtual: "2500", valorAlvo: "4000" });
    assert.equal(partial.percentual, 62.5);
    assert.equal(partial.atingida, false);
    assert.equal(partial.restante.toFixed(2), "1500.00");

    const complete = calculateMetaProgress({ valorAtual: "4500", valorAlvo: "4000" });
    assert.equal(complete.percentual, 100);
    assert.equal(complete.atingida, true);
    assert.equal(complete.restante.toFixed(2), "0.00");
  });

  it("uses current month window for monthly goals", () => {
    const window = getMetaPeriodWindow(
      { periodicidade: "MENSAL", dataInicio: new Date(2026, 0, 10) },
      new Date(2026, 5, 30, 12),
    );

    assert.equal(localDateKey(window.inicio), "2026-06-01");
    assert.equal(localDateKey(window.fim), "2026-06-30");
  });

  it("builds historical windows without crossing the goal start date", () => {
    const windows = getMetaHistoryWindows(
      { periodicidade: "MENSAL", dataInicio: new Date(2026, 3, 1) },
      new Date(2026, 5, 30, 12),
      6,
    );

    assert.deepEqual(
      windows.map((item) => localDateKey(item.inicio)),
      ["2026-04-01", "2026-05-01", "2026-06-01"],
    );
  });
});
