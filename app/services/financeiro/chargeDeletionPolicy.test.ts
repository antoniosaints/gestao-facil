import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canDeleteOperationalCharge } from "./chargeDeletionPolicy";

describe("canDeleteOperationalCharge", () => {
  it("keeps regular users restricted to cancelled or reversed charges", () => {
    assert.equal(canDeleteOperationalCharge("CANCELADO", false), true);
    assert.equal(canDeleteOperationalCharge("ESTORNADO", false), true);
    assert.equal(canDeleteOperationalCharge("PENDENTE", false), false);
    assert.equal(canDeleteOperationalCharge("EFETIVADO", false), false);
  });

  it("allows root to delete pending gateway charges without allowing paid charges", () => {
    assert.equal(canDeleteOperationalCharge("PENDENTE", true), true);
    assert.equal(canDeleteOperationalCharge("CANCELADO", true), true);
    assert.equal(canDeleteOperationalCharge("ESTORNADO", true), true);
    assert.equal(canDeleteOperationalCharge("EFETIVADO", true), false);
  });
});
