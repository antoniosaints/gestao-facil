import { test } from "node:test";
import assert from "node:assert/strict";
import { criarVariante, reporLote, editarAvancado, editarParametrosOperacionais, getParametrosOperacionais, editarContaFinanceira, editarPessoaAvancado, editarServicoAvancado, editarServicoBasico, getEmpresa, editarEmpresa } from "../operacoes/cadastros";
import { criarProduto, reporEstoque } from "../produtos/service";
import { registrarReposicaoLote } from "../../services/produtos/produtoEstoqueOperations";
import { criarProdutoVariante } from "../../services/produtos/produtoCadastroService";
import { registrarPagamentoSePendente } from "../../services/financeiro/parcelaPagamentoService";
import { database } from "./fixtures";
import { pagamentoSchema, recorrenciaSchema, pessoaAvancadoSchema, parametrosSchema, contaPatchSchema, contaSchema } from "../operacoes/schemas";
import { lancamentoSchema } from "../adapters/schemas";

const produto = { chaveOperacao: "9509e4e7-776a-4f30-b4e7-215a003d1341", nome: "Café", unidade: "kg", preco: 30, estoque: 2.5, minimo: .25 };
const variante = { chaveOperacao: "9509e4e7-776a-4f30-b4e7-215a003d1342", nomeVariante: "500g", unidade: "kg", preco: 18, estoque: .5, minimo: .125 };
const lote = { chaveOperacao: "9509e4e7-776a-4f30-b4e7-215a003d1343", data: "2026-10-26T09:00:00-03:00", frete: 1, desconto: .3, itens: [{ produtoId: 201, quantidade: 2.5, custo: 10 }, { produtoId: 202, quantidade: .5, custo: 20 }] };

test("variante usa base existente sem alterar padrão/avançados; replay não duplica", async () => {
  const d = database(); await criarProduto(d.db, 1, produto); const original = structuredClone(d.state().variants[0]);
  const created = await criarVariante(d.db, 1, 101, variante); assert.equal(created.replay, false);
  assert.equal(d.state().variants.length, 2); assert.deepEqual(d.state().variants[0], original);
  assert.equal(d.state().variants[1].ehPadrao, false); assert.equal(d.state().variants[1].estoque, .5); assert.equal(d.state().variants[1].minimo, .125);
  assert.equal((await criarVariante(d.db, 1, 101, variante)).replay, true); assert.equal(d.state().variants.length, 2);
  await assert.rejects(criarVariante(d.db, 2, 101, variante), { status: 404 });
});
test("criação compartilhada de variante equivale ao Fácil para saldo, preço, unidade e vínculo", async () => {
  const a = database(), b = database(); await criarProduto(a.db, 1, produto); await criarProduto(b.db, 1, produto);
  await criarVariante(a.db, 1, 101, variante);
  await b.db.$transaction(tx => criarProdutoVariante(tx, 1, { produtoBaseId: 101, nome: "Café", nomeVariante: "500g", unidade: "kg", preco: 18, estoque: .5, minimo: .125, entradas: true, saidas: true, controlaEstoque: true }));
  for (const field of ["produtoBaseId", "nome", "nomeVariante", "unidade", "preco", "estoque", "minimo", "ehPadrao", "controlaEstoque"]) assert.equal(a.state().variants[1][field], b.state().variants[1][field]);
});
test("avançados atualizam somente campos explícitos e a entidade escolhida", async () => {
  const d = database(); await criarProduto(d.db, 1, produto); await criarVariante(d.db, 1, 101, variante);
  Object.assign(d.state().variants[0], { precoPromocional: 22, ncm: "0901", codigo: "SKU", imagem: "original" });
  const other = structuredClone(d.state().variants[1]);
  await editarAvancado(d.db, 1, 101, 201, { mostrarNoCatalogo: false });
  assert.equal(d.state().variants[0].precoPromocional, 22); assert.equal(d.state().variants[0].estoque, 2.5); assert.equal(d.state().variants[0].imagem, "original");
  assert.deepEqual(d.state().variants[1], other);
  await editarAvancado(d.db, 1, 101, null, { ncm: "0902" });
  assert.equal(d.state().bases[0].ncm, "0902"); assert.equal(d.state().variants[0].ncm, "0901");
  for (const field of [{ estoque: 0 }, { id: 1 }, { ehPadrao: true }]) await assert.rejects(editarAvancado(d.db, 1, 101, 201, field));
  await assert.rejects(editarAvancado(d.db, 2, 101, 201, { ncm: null }), { status: 404 });
});
test("lote preserva rateio, data, frações, total e idempotência sem financeiro adicional", async () => {
  const d = database(); await criarProduto(d.db, 1, produto); await criarVariante(d.db, 1, 101, variante);
  const result = await reporLote(d.db, 1, lote); const data = result.data as any;
  assert.equal(data.totalItens, 2); assert.equal(data.totalUnidades, 3);
  assert.equal(d.state().variants[0].estoque, 5); assert.equal(d.state().variants[1].estoque, 1);
  const [a, b] = d.state().movements; assert.equal(a.frete, .71); assert.equal(b.frete, .29); assert.equal(a.desconto, .21); assert.equal(b.desconto, .09);
  assert.equal(a.data.toISOString(), "2026-10-26T12:00:00.000Z");
  assert.equal((await reporLote(d.db, 1, lote)).replay, true); assert.equal(d.state().movements.length, 2);
  await assert.rejects(reporLote(d.db, 1, { ...lote, frete: 2 }), { status: 409 });
});
test("lote inválido reverte itens anteriores e chave; regra compartilhada mantém mesmos efeitos", async () => {
  const a = database(), b = database();
  for (const d of [a, b]) { await criarProduto(d.db, 1, produto); await criarVariante(d.db, 1, 101, variante); }
  a.state().variants[1].entradas = false;
  await assert.rejects(reporLote(a.db, 1, lote)); assert.equal(a.state().variants[0].estoque, 2.5); assert.equal(a.state().movements.length, 0);
  a.state().variants[1].entradas = true; await reporLote(a.db, 1, lote);
  await b.db.$transaction(tx => registrarReposicaoLote(tx, 1, { ...lote, data: new Date(lote.data) }));
  for (const field of ["quantidade", "custo", "frete", "desconto", "tipo", "produtoId", "contaId"]) {
    assert.equal(a.state().movements[0][field], b.state().movements[0][field]); assert.equal(a.state().movements[1][field], b.state().movements[1][field]);
  }
});
test("pagamento atômico só permite uma requisição continuar para criar saldo pendente", async () => {
  let paid = false, writes = 0;
  const tx: any = { parcelaFinanceiro: { updateMany: async ({ where, data }: any) => {
    assert.deepEqual(where, { id: 5, pago: false });
    if (paid) return { count: 0 }; paid = data.pago; writes++; return { count: 1 };
  } } };
  const results = await Promise.allSettled([registrarPagamentoSePendente(tx, 5, { pago: true, valor: 40, valorPago: 40 }), registrarPagamentoSePendente(tx, 5, { pago: true, valor: 40, valorPago: 40 })]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(writes, 1);
  assert.equal((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason.status, 409);
});
test("schemas de parcial, recorrência e parcelamento manual mantêm contratos fechados", () => {
  const p = { metodoPagamento: "PIX", dataPagamento: "2026-10-26T12:00:00Z", valorRecebido: "40.50", criarSaldoPendente: true };
  assert.equal(pagamentoSchema.safeParse(p).success, false); assert.equal(pagamentoSchema.parse({ ...p, novoVencimento: "2026-11-26T12:00:00Z" }).valorRecebido, 40.5);
  const recurrence = { frequencia: "MENSAL", intervaloDias: null, dataInicio: "2026-10-26T12:00:00Z", dataFim: null, minimoGerado: 1, maximoEmAberto: 6, geracaoAutomatica: false, diasAntecedencia: 30, valorParcela: "20.50" };
  assert.equal(recorrenciaSchema.parse(recurrence).valorParcela, 20.5);
  const data = { chaveOperacao: produto.chaveOperacao, descricao: "Plano", tipo: "RECEITA", valorTotal: 200, categoriaId: 2, dataLancamento: p.dataPagamento, formaPagamento: "PIX", lancamentoEfetivado: false, tipoLancamentoModo: "PARCELADO", parcelas: 4 };
  assert.equal(lancamentoSchema.safeParse(data).success, true); assert.equal(lancamentoSchema.safeParse({ ...data, vendaId: 100 }).success, false);
});
test("pessoas validam documento/CEP; campos omitidos não entram na escrita", () => {
  assert.deepEqual(pessoaAvancadoSchema.parse({ endereco: "Rua Exemplo" }), { endereco: "Rua Exemplo" });
  assert.equal(pessoaAvancadoSchema.safeParse({ documento: "11111111111" }).success, false);
  assert.equal(pessoaAvancadoSchema.safeParse({ documento: "abc" }).success, false);
  assert.equal(pessoaAvancadoSchema.safeParse({ cep: "1" }).success, false); assert.equal(pessoaAvancadoSchema.safeParse({ tipo: "AMBOS" }).success, false);
  assert.deepEqual(pessoaAvancadoSchema.parse({ cep: "12345-678" }), { cep: "12345678" });
});
test("configuração operacional não aceita credenciais/estiloUi e valida referências próprias", async () => {
  for (const extra of [{ MercadoPagoApiKey: "example" }, { estiloUi: "SIDEV2" }, { contaId: 2 }]) assert.equal(parametrosSchema.safeParse({ ...extra, modeloPdv: "BASICO" }).success, false);
  assert.equal(contaPatchSchema.safeParse({ saldoInicial: 0 }).success, false);
  assert.equal(contaSchema.parse({ nome: "Conta exemplo", saldoInicial: "-100.50", corDestaque: null }).saldoInicial, -100.5);
});
test("projeção operacional e PATCH preservam secrets e aparência existentes", async () => {
  const values: any = { contaId: 1, MercadoPagoApiKey: "test-secret-never-returned", estiloUi: "SIDEV2", vendaLancamentoAutomatico: false, contaFinanceiraPadraoId: 3 };
  const selected = (select: any) => Object.fromEntries(Object.keys(select).map(k => [k, values[k] ?? null]));
  const tx: any = {
    parametrosConta: { findUnique: async ({ select }: any) => selected(select), upsert: async ({ update }: any) => { Object.assign(values, update); return { contaId: 1 }; } },
    contasFinanceiro: { findFirst: async ({ where }: any) => where.id === 3 && where.contaId === 1 ? { id: 3 } : null },
    categoriaFinanceiro: { findFirst: async () => null },
  };
  const db: any = { ...tx, $transaction: async (f: any) => f(tx) };
  await editarParametrosOperacionais(db, 1, { vendaLancamentoAutomatico: true });
  const response = await getParametrosOperacionais(db, 1);
  assert.equal(values.estiloUi, "SIDEV2"); assert.equal(values.MercadoPagoApiKey, "test-secret-never-returned");
  assert.equal("MercadoPagoApiKey" in response, false); assert.equal("estiloUi" in response, false);
  await assert.rejects(editarParametrosOperacionais(db, 1, { contaFinanceiraPadraoId: 99 }), { status: 404 });
});
test("reposição individual aceita data explícita sem alterar custo/configurações", async () => {
  const d = database(); await criarProduto(d.db, 1, produto);
  await reporEstoque(d.db, 1, { produtoId: 201, quantidade: .5, custo: 20, data: "2026-10-25T09:00:00-03:00" });
  assert.equal(d.state().movements[0].data.toISOString(), "2026-10-25T12:00:00.000Z");
  assert.equal(d.state().variants[0].preco, 30); assert.equal(d.state().variants[0].estoque, 3);
});
test("PATCH básico e avançado de serviço/pessoa/conta não zeram campos omitidos", async () => {
  const records: any = { servicos: { id: 1, contaId: 1, nome: "Serviço", preco: 20, descricao: "Preservada", ncm: "0901", status: true }, clientesFornecedores: { id: 1, contaId: 1, documento: "CPF fictício preservado", cep: "12345678", endereco: "Rua Antiga", nome: "Cliente" }, contasFinanceiro: { id: 1, contaId: 1, nome: "Caixa", saldoInicial: 250, icone: "icone-original", corDestaque: "#123456" } };
  const db: any = {};
  for (const key of Object.keys(records)) db[key] = {
    updateMany: async ({ where, data }: any) => { if (where.id !== 1 || where.contaId !== 1) return { count: 0 }; Object.assign(records[key], data); return { count: 1 }; },
    findFirst: async () => ({ ...records[key] }),
  };
  await editarServicoBasico(db, 1, 1, { descricao: null }); assert.equal(records.servicos.preco, 20); assert.equal(records.servicos.ncm, "0901");
  await editarServicoAvancado(db, 1, 1, { status: false }); assert.equal(records.servicos.preco, 20);
  await editarPessoaAvancado(db, 1, 1, { endereco: "Nova rua" }); assert.equal(records.clientesFornecedores.documento, "CPF fictício preservado"); assert.equal(records.clientesFornecedores.cep, "12345678");
  await editarContaFinanceira(db, 1, 1, { nome: "Banco" }); assert.equal(records.contasFinanceiro.saldoInicial, 250); assert.equal(records.contasFinanceiro.icone, "icone-original");
  await assert.rejects(editarContaFinanceira(db, 2, 1, { nome: "Fora" }), { status: 404 });
});
test("empresa usa schema atual parcial e projeção sem certificado, assinatura ou credenciais", async () => {
  const record: any = { id: 1, nome: "Empresa exemplo", telefone: "000", documento: "Documento preservado", tipo: "PJ", asaasCustomerId: "ficticio", certificadoPath: "nao-retornar" };
  const pick = (select: any) => Object.fromEntries(Object.keys(select).map(k => [k, record[k] ?? null]));
  const db: any = { contas: { findUnique: async ({ where, select }: any) => { assert.equal(where.id, 1); return pick(select); }, update: async ({ where, select, data }: any) => { assert.equal(where.id, 1); Object.assign(record, data); return pick(select); } } };
  const result = await editarEmpresa(db, 1, { telefone: "Novo" });
  assert.equal(record.documento, "Documento preservado"); assert.equal(record.asaasCustomerId, "ficticio");
  assert.equal("certificadoPath" in result, false); assert.equal("asaasCustomerId" in await getEmpresa(db, 1), false);
  await assert.rejects(editarEmpresa(db, 1, { status: "BLOQUEADO" }));
});
