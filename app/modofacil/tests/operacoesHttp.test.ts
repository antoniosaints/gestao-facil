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
test("HTTP situação de produto exige nível de produtos, valida campos e escopo da conta", async t => {
  const h = await harness(t), writes: any[] = [];
  let found = true;
  h.db.$transaction = async (work: any) => work(h.db);
  h.db.$queryRaw = async () => [];
  h.db.produtoBase = {
    findFirst: async ({ where }: any) => { assert.deepEqual(where, { id: 7, contaId: 1 }); return found ? { id: 7 } : null; },
    updateMany: async (query: any) => { writes.push(query); return { count: 1 }; },
  };
  h.db.produto = { updateMany: async (query: any) => { writes.push(query); return { count: 2 }; } };
  for (const role of ["usuario", "vendedor", "gerente"])
    assert.equal((await h.send("/produtos/7/status", { status: "INATIVO" }, "PATCH", { "x-test-role": role })).status, 403);
  for (const body of [{ status: false }, { status: "BLOQUEADO" }, { status: "ATIVO", preco: 0 }])
    assert.equal((await h.send("/produtos/7/status", body, "PATCH")).status, 422);
  for (const id of ["0", "-1", "abc", "1.5"])
    assert.equal((await h.send(`/produtos/${id}/status`, { status: "INATIVO" }, "PATCH")).status, 422);
  assert.equal(writes.length, 0);
  assert.equal((await h.send("/produtos/7/status", { status: "INATIVO" }, "PATCH")).status, 200);
  assert.deepEqual(writes, [
    { where: { id: 7, contaId: 1 }, data: { status: "INATIVO" } },
    { where: { produtoBaseId: 7, contaId: 1 }, data: { status: "INATIVO" } },
  ]);
  found = false;
  assert.equal((await h.send("/produtos/7/status", { status: "ATIVO" }, "PATCH")).status, 404);
  assert.equal(writes.length, 2);
});
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
test('HTTP ativação de serviço valida boolean, conta e permissão antes de atualizar', async t => {
  const h = await harness(t); const writes: any[] = [];
  h.db.servicos = {updateMany:async(query:any)=>{writes.push(query);return {count:1};},findFirst:async()=>({id:7,status:false})};
  assert.equal((await h.send('/servicos/7/status',{status:false},'PATCH',{'x-test-role':'usuario'})).status,403);
  assert.equal((await h.send('/servicos/7/status',{status:'false'},'PATCH',{'x-test-role':'vendedor'})).status,422);
  assert.equal(writes.length,0);
  assert.equal((await h.send('/servicos/7/status',{status:false},'PATCH',{'x-test-role':'vendedor'})).status,200);
  assert.deepEqual(writes,[{where:{id:7,contaId:1},data:{status:false}}]);
});

test('HTTP seletores paginados respeitam permissões e conta autenticada', async t => {
  const h = await harness(t);
  const optionQueries: any[] = [];
  const model = { findMany: async (args: any) => { optionQueries.push(args); return [{ id: 95, nome: 'Categoria distante' }]; } };
  h.db.categoriaFinanceiro = model;
  h.db.contasFinanceiro = model;
  h.db.produtoCategoria = model;
  const response = await h.send('/financeiro/categorias/opcoes?page=2&search=aluguel', undefined, 'GET');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { results: [{ id: 95, label: 'Categoria distante' }], hasMore: false });
  assert.equal(optionQueries[0].where.contaId, 1);
  assert.equal(optionQueries[0].skip, 20);
  assert.equal((await h.send('/financeiro/contas/opcoes', undefined, 'GET', { 'x-test-role': 'vendedor' })).status, 403);
  assert.equal((await h.send('/produtos/categorias/opcoes', undefined, 'GET', { 'x-test-role': 'gerente' })).status, 403);
  assert.equal(optionQueries.length, 1);
  assert.equal((await h.send('/produtos/categorias/opcoes?id=95', undefined, 'GET')).status, 200);
  assert.equal(optionQueries[1].where.id, 95);
  assert.equal(optionQueries[1].where.contaId, 1);
});

test('HTTP exclusões delegam ao domínio com IDs validados, conta e permissão atual', async t => {
  const h = await harness(t);
  const resources = [
    { path: '/vendas/7', model: 'vendas', handler: 'deleteVenda', denied: 'vendedor', allowed: 'gerente' },
    { path: '/produtos/7', model: 'produtoBase', handler: 'deleteProduto', denied: 'gerente', allowed: 'admin' },
    { path: '/financeiro/lancamentos/7', model: 'lancamentoFinanceiro', handler: 'deletarLancamento', denied: 'vendedor', allowed: 'gerente' },
    { path: '/servicos/7', model: 'servicos', handler: 'deleteServico', denied: 'usuario', allowed: 'vendedor' },
    { path: '/pessoas/7', model: 'clientesFornecedores', handler: 'deleteCliente', denied: 'usuario', allowed: 'vendedor' },
  ];
  for (const resource of resources) {
    const queries: any[] = [];
    (h.db as any)[resource.model] = { findFirst: async (query: any) => { queries.push(query); return { id: 7, status: 'PENDENTE', faturado: false }; } };
    const before = h.calls.length;
    assert.equal((await h.send(resource.path, undefined, 'DELETE', { 'x-test-role': resource.denied })).status, 403);
    assert.equal(h.calls.length, before);
    assert.equal(queries.length, 0);
    assert.equal((await h.send(resource.path, undefined, 'DELETE', { 'x-test-role': resource.allowed })).status, 200);
    assert.equal(h.calls.length, before + 1);
    assert.equal(h.calls.at(-1).handler, resource.handler);
    assert.equal(h.calls.at(-1).contaId, 1);
    assert.deepEqual(queries[0].where, { id: 7, contaId: 1 });
  }
});
test('HTTP exclusões de registro de outra conta ou ID inválido não chegam ao domínio', async t => {
  const h = await harness(t);
  for (const [base, model] of [['/vendas', 'vendas'], ['/produtos', 'produtoBase'], ['/financeiro/lancamentos', 'lancamentoFinanceiro'], ['/servicos', 'servicos'], ['/pessoas', 'clientesFornecedores']]) {
    const queries: any[] = [];
    (h.db as any)[model] = { findFirst: async (query: any) => { queries.push(query); return null; } };
    assert.equal((await h.send(`${base}/99`, undefined, 'DELETE')).status, 404);
    assert.deepEqual(queries[0].where, { id: 99, contaId: 1 });
    for (const id of ['0', '-1', 'abc', '1.5']) assert.equal((await h.send(`${base}/${id}`, undefined, 'DELETE')).status, 422);
    assert.equal(queries.length, 1);
  }
  assert.equal(h.calls.length, 0);
});
test('HTTP exclusão de venda faturada exige estorno antes de chamar a operação', async t => {
  const h = await harness(t);
  for (const state of [{ status: 'FATURADO', faturado: false }, { status: 'PENDENTE', faturado: true }]) {
    h.db.vendas.findFirst = async () => ({ id: 7, ...state });
    const result = await h.send('/vendas/7', undefined, 'DELETE');
    assert.equal(result.status, 409);
    assert.equal((await result.json()).code, 'sale_invoiced');
  }
  assert.equal(h.calls.length, 0);
});
