import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createOperacoesRouter, operacoesAdicionais } from "../operacoes/router";

async function harness(t: any) {
  const calls: any[] = [], queries: any[] = []; let role = "admin";
  const db: any = {
    usuarios: { findFirst: async ({ where }: any) => { queries.push({ users: where }); return { permissao: role, status: "ATIVO", Contas: { status: "ATIVO" } }; } },
    cobrancasFinanceiras: { findFirst: async (input: any) => { queries.push({ charge: input.where }); return null; } },
    ordensServico: { findFirst: async (input: any) => { queries.push({ os: input }); return null; } },
    vendas: { findFirst: async (input: any) => { queries.push({ sale: input.where }); return null; } },
    parcelaFinanceiro: { findFirst: async (input: any) => { queries.push({ installment: input.where }); return null; } },
    parametrosConta: { findUnique: async ({ select }: any) => { queries.push({ paramsSelect: select }); return Object.fromEntries(Object.keys(select).map(k => [k, null])); } },
  };
  const handlers: any = {};
  for (const operation of operacoesAdicionais) handlers[operation.handler] = (req: any, res: any) => { calls.push({ handler: operation.handler, body: req.body, query: req.query, contaId: req.customData.contaId }); res.json({ handled: operation.handler }); };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { role = String(req.headers["x-test-role"] ?? "admin"); (req as any).customData = { contaId: 1, userId: 10, permissao: "root" }; next(); });
  app.use("/api/modofacil", createOperacoesRouter(db, handlers, { venda: async () => undefined, os: async () => undefined, hasCombos: async () => false }));
  app.use((error: any, _req: any, res: any, _next: any) => { res.status(error.status ?? 422).json({ code: error.code ?? "validation" }); });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/modofacil`;
  const send = (path: string, body?: unknown, method = "POST", headers: Record<string, string> = {}) => fetch(url + path, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { send, calls, queries, db };
}
test("HTTP parcial/recorrência/transferência delegam uma única operação, validação rejeita campos ambíguos", async t => {
  const h = await harness(t);
  const p = { metodoPagamento: "PIX", dataPagamento: "2026-10-26T12:00:00Z", valorRecebido: "40.50", criarSaldoPendente: true };
  assert.equal((await h.send("/financeiro/parcelas/5/pagar", p)).status, 422); assert.equal(h.calls.length, 0);
  assert.equal((await h.send("/financeiro/parcelas/5/pagar", { ...p, novoVencimento: "2026-11-26T12:00:00Z" })).status, 200);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].handler, "pagarParcela"); assert.equal(h.calls[0].body.valorRecebido, 40.5);
  assert.equal((await h.send("/financeiro/transferencias", { modo: "INVALIDO", contaOrigemId: 2, contaDestinoId: 3 })).status, 422);
  assert.equal((await h.send("/financeiro/transferencias", { modo: "GERAR_FINANCEIRO", contaOrigemId: 2, contaDestinoId: 3, valor: "10.50", data: p.dataPagamento, descricao: "Transferência" })).status, 200);
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].handler, "transferirContaFinanceira");
  assert.equal((await h.send("/financeiro/lancamentos/5/recorrencia/status", { ativo: false })).status, 200);
  assert.equal(h.calls.length, 3); assert.equal(h.calls[2].body.encerrar, false);
});
test("HTTP financeiro nível3/conta nível4 preservam autorização atual do banco", async t => {
  const h = await harness(t);
  const p = { metodoPagamento: "PIX", dataPagamento: "2026-10-26T12:00:00Z" };
  assert.equal((await h.send("/financeiro/parcelas/5/pagar", p, "POST", { "x-test-role": "vendedor" })).status, 403);
  assert.equal((await h.send("/financeiro/contas", { nome: "Conta", saldoInicial: 0, corDestaque: null }, "POST", { "x-test-role": "gerente" })).status, 403);
  assert.equal(h.calls.length, 0);
  assert.equal((await h.send("/financeiro/parcelas/5/pagar", p, "POST", { "x-test-role": "gerente" })).status, 200);
  assert.equal(h.calls.length, 1);
});
test("HTTP cobrança e mensagem de outra conta são barradas antes do handler externo", async t => {
  const h = await harness(t);
  for (const action of ["cancelar", "estornar"]) assert.equal((await h.send(`/financeiro/cobrancas/${action}`, { cobrancaId: 99 })).status, 404);
  assert.equal((await h.send("/financeiro/cobrancas", { type: "PIX", value: 10, gateway: "mercadopago", vinculo: { tipo: "venda", id: 99 } })).status, 404);
  assert.equal((await h.send("/servicos/ordens/99/mensagens", { mensagem: "Exemplo fictício" })).status, 404);
  assert.equal(h.calls.length, 0);
  assert.ok(h.queries.some(q => q.charge?.contaId === 1)); assert.ok(h.queries.some(q => q.sale?.contaId === 1));
});
test("HTTP leitura de configuração usa apenas projeção segura; histórico exige nível3", async t => {
  const h = await harness(t);
  const response = await h.send("/configuracoes/operacionais", undefined, "GET"); assert.equal(response.status, 200);
  const data = await response.json(); assert.equal("MercadoPagoApiKey" in data.data, false); assert.equal("estiloUi" in data.data, false);
  const select = h.queries.find(q => q.paramsSelect).paramsSelect; assert.equal("AbacatePaySecret" in select, false);
  assert.equal((await h.send("/pessoas/7/historico?tab=vendas", undefined, "GET", { "x-test-role": "vendedor" })).status, 403);
  assert.equal((await h.send("/pessoas/7/historico?tab=INVALIDO", undefined, "GET")).status, 422);
});
test("HTTP OS consulta seleciona autor/operador sem credenciais", async t => {
  const h = await harness(t);
  assert.equal((await h.send("/servicos/ordens/1", undefined, "GET")).status, 404);
  const query = h.queries.find(q => q.os?.include)?.os;
  assert.deepEqual(query.include.Operador, { select: { id: true, nome: true } });
  assert.deepEqual(query.include.MensagensInteracoesOrdemServico.include.Autor, { select: { id: true, nome: true } });
});
test("HTTP cobrança já paga ou ativa é recusada antes de qualquer gateway", async t => {
  const h = await harness(t); const input = { type: "PIX", value: 10, gateway: "mercadopago", vinculo: { tipo: "os", id: 1 } };
  h.db.ordensServico.findFirst = async () => ({ id: 1, status: "FATURADA" });
  assert.equal((await h.send("/financeiro/cobrancas", input)).status, 409); assert.equal(h.calls.length, 0);
  h.db.ordensServico.findFirst = async () => ({ id: 1, status: "ABERTA" }); h.db.cobrancasFinanceiras.findFirst = async () => ({ id: 99 });
  assert.equal((await h.send("/financeiro/cobrancas", input)).status, 409); assert.equal(h.calls.length, 0);
});
test("HTTP fiscal de serviço exige administrador; status permanece ação do catálogo", async t => {
  const h = await harness(t);
  assert.equal((await h.send("/servicos/7/avancado", { ncm: "0901" }, "PATCH", { "x-test-role": "vendedor" })).status, 403);
  assert.equal(h.calls.length, 0);
});
