import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createConfiguracaoRouter } from "../configuracao/router";
import { requireAccess } from "../access";

test("HTTP configuração: resposta direta, 403, 409, isolamento e socket falho após commit", async t => {
  const rows = new Map<number, any>();
  const db: any = {
    usuarios: { findFirst: async ({ where }: any) => ({ status: "ATIVO", permissao: where.id === 10 ? "admin" : "usuario", Contas: { status: "ATIVO" } }) },
    modoFacilConfiguracao: {
      findUnique: async ({ where }: any) => rows.get(where.contaId) ?? null,
      create: async ({ data }: any) => { if (rows.has(data.contaId)) throw { code: "P2002" }; rows.set(data.contaId, data); return data; },
    },
  };
  const app = express(); app.use(express.json());
  // Only the session injection is simulated. Real configuration router and
  // access middleware are exercised over HTTP without importing Redis/queues.
  app.use((req, _res, next) => {
    (req as any).customData = { userId: req.headers["x-test-user"] === "user" ? 11 : 10, contaId: Number(req.headers["x-test-account"] ?? 1), permissao: "root" }; next();
  });
  let notifications = 0;
  app.use("/api/modofacil", requireAccess(db), createConfiguracaoRouter(db, () => { notifications++; throw new Error("socket"); }));
  app.use((error: any, _req: any, res: any, _next: any) => { res.status(error.status ?? 422).json({ message: error.message }); });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/modofacil/configuracao`;
  assert.deepEqual(await (await fetch(url)).json(), { modo: "NORMAL", versao: 0, podeAlterar: true });
  const put = (body: any, headers = {}) => fetch(url, { method: "PUT", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.equal((await put({ modo: "FACIL", versao: 0 }, { "x-test-user": "user" })).status, 403);
  const response = await put({ modo: "FACIL", versao: 0 }); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { modo: "FACIL", versao: 1, podeAlterar: true }); assert.equal(notifications, 1);
  assert.equal((await put({ modo: "FACIL", versao: 0 })).status, 409);
  assert.equal((await put({ modo: "FACIL", versao: 1, contaId: 2 })).status, 422);
  assert.deepEqual(await (await fetch(url, { headers: { "x-test-account": "2" } })).json(), { modo: "NORMAL", versao: 0, podeAlterar: true });
});
