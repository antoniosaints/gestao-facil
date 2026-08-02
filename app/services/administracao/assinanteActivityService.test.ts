import assert from "node:assert/strict";
import test from "node:test";
import { countUniqueOnlineUsers } from "./assinanteActivityPolicy";

test("conta usuarios unicos online sem contar suporte ou outra conta", () => {
  const sockets = [
    { data: { contaId: 10, userId: 1, presenceEligible: true } },
    { data: { contaId: 10, userId: 1, presenceEligible: true } },
    { data: { contaId: 10, userId: 2, presenceEligible: true } },
    { data: { contaId: 10, userId: 3, presenceEligible: false } },
    { data: { contaId: 11, userId: 4, presenceEligible: true } },
    { data: {} },
  ];

  assert.equal(countUniqueOnlineUsers(sockets, 10), 2);
});
