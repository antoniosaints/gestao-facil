import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Router } from "express";
import { createAppModuleAccess } from "../../middlewares/appModuleAccessPolicy";
import { registerInstanceWebhookLogRoutes } from "./instanceWebhookLogs";

async function request(input: { method?: string; whatsapp?: boolean; atendimento?: boolean; root?: boolean }) {
  const router = Router();
  let atendimentoChecks = 0;
  let replayed = false;
  router.use(createAppModuleAccess("whatsapp", "WhatsApp", async () => input.whatsapp !== false, async () => input.root !== false));
  registerInstanceWebhookLogRoutes(router, {
    list(req, res) {
      res.json({ data: [{ id: 1, instanciaId: Number(req.params.id) }] });
    },
    atendimentoAccess(_req, res, next) {
      atendimentoChecks++;
      if (!input.atendimento) { res.status(403).json({ error: { code: "atendimento_app-inativo" } }); return; }
      next();
    },
    retry(_req, res) { replayed = true; res.json({ ok: true }); },
  });
  const method = input.method || "GET";
  const result = await new Promise<{ status: number; body: any }>((resolve, reject) => {
    let status = 200;
    const response = { status(value: number) { status = value; return this; }, json(body: any) { resolve({ status, body }); return this; } };
    router({ method, url: method === "GET" ? "/instances/42/eventos" : "/instances/42/eventos/1/retry", customData: { contaId: 37 } } as any, response as any, error => error ? reject(error) : resolve({ status: 404, body: null }));
  });
  return { ...result, atendimentoChecks, replayed };
}

describe("logs de webhook da instância", () => {
  it("permite consultar com WhatsApp ativo sem contratar Atendimento", async () => {
    const result = await request({ atendimento: false });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data, [{ id: 1, instanciaId: 42 }]);
    assert.equal(result.atendimentoChecks, 0);
    assert.equal(result.replayed, false);
  });
  it("mantém a consulta bloqueada sem o app WhatsApp ativo", async () => {
    const result = await request({ whatsapp: false, atendimento: true });
    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, "whatsapp_module_inactive");
  });
  it("mantém a consulta restrita à permissão de gestão da instância", async () => {
    const result = await request({ root: false });
    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, "app_access_forbidden");
  });
  it("continua exigindo Atendimento para reprocessar um evento", async () => {
    const result = await request({ method: "POST", atendimento: false });
    assert.equal(result.status, 403);
    assert.equal(result.atendimentoChecks, 1);
    assert.equal(result.replayed, false);
  });
  it("encaminha replay autorizado sem mudar o contrato da rota existente", async () => {
    const result = await request({ method: "POST", atendimento: true });
    assert.equal(result.status, 200);
    assert.equal(result.atendimentoChecks, 1);
    assert.equal(result.replayed, true);
  });
});
