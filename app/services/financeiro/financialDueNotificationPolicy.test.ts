import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getFinancialDueMilestone,
  selectFinancialDueNotificationRecipients,
} from "./financialDueNotificationPolicy";

describe("financialDueNotificationPolicy", () => {
  it("maps due dates to the configured notification milestones", () => {
    const today = new Date(2026, 5, 30, 12);

    assert.equal(getFinancialDueMilestone(new Date(2026, 6, 3), today), "D3");
    assert.equal(getFinancialDueMilestone(new Date(2026, 6, 1), today), "D1");
    assert.equal(getFinancialDueMilestone(new Date(2026, 5, 30), today), "D0");
    assert.equal(getFinancialDueMilestone(new Date(2026, 5, 29), today), "D1_APOS");
    assert.equal(getFinancialDueMilestone(new Date(2026, 6, 2), today), null);
  });

  it("selects only active admin and root users as recipients", () => {
    const recipients = selectFinancialDueNotificationRecipients([
      { id: 1, nome: "Root", permissao: "root", status: "ATIVO" },
      { id: 2, nome: "Admin", permissao: "admin", status: "ATIVO" },
      { id: 3, nome: "Gerente", permissao: "gerente", status: "ATIVO" },
      { id: 4, nome: "Inativo", permissao: "root", status: "INATIVO" },
    ]);

    assert.deepEqual(recipients, [
      { id: 1, nome: "Root" },
      { id: 2, nome: "Admin" },
    ]);
  });
});
