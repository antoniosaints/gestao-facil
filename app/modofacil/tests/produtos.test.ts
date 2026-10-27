import { test } from "node:test";
import assert from "node:assert/strict";
import { criarProduto, editarProduto, alterarSituacaoProduto, reporEstoque, descartarEstoque } from "../produtos/service";
import { criarProdutoSchema, editarProdutoSchema, quantity, money } from "../produtos/schemas";
import { criarProdutoBase } from "../../services/produtos/produtoCadastroService";
import { ProdutoSchema } from "../../schemas/produtos";
import { database } from "./fixtures";

const input = { chaveOperacao: "9509e4e7-776a-4f30-b4e7-215a003d1341", nome: "Café", categoriaId: null, unidade: "kg", preco: "35.90", precoCompra: null, estoque: "0.250", minimo: "0.100", descricao: null };
const dataOf = (result: any) => result.data as any;

test("situação do produto sincroniza variantes da conta sem alterar estoque, preços ou fiscal", async () => {
  const d = database(); await criarProduto(d.db, 1, input);
  const base = d.state().bases[0], variant = d.state().variants[0];
  base.status = variant.status = "ATIVO"; variant.ncm = "0901";
  d.state().variants.push({ ...variant, id: 202, status: "INATIVO" });
  d.state().variants.push({ ...variant, id: 203, produtoBaseId: 999 });
  d.state().variants.push({ ...variant, id: 204, contaId: 2 });
  const before = structuredClone(d.state());
  for (const status of ["INATIVO", "ATIVO"] as const) {
    assert.deepEqual(await alterarSituacaoProduto(d.db, 1, 101, { status }), { id: 101, status });
    assert.equal(d.state().bases[0].status, status);
    d.state().variants.slice(0, 2).forEach((row: any) => assert.equal(row.status, status));
    d.state().variants.forEach((row: any, index: number) => {
      const { status: _old, ...original } = before.variants[index];
      const { status: _new, ...current } = row;
      assert.deepEqual(current, original);
    });
    assert.equal(d.state().variants[2].status, "ATIVO");
    assert.equal(d.state().variants[3].status, "ATIVO");
  }
  assert.deepEqual(d.state().movements, before.movements);
  assert.ok(d.writes.some(w => w.lock));
});
test("situação valida payload, isola conta e reverte base se atualização de variantes falhar", async () => {
  const d = database(); await criarProduto(d.db, 1, input);
  d.state().bases[0].status = d.state().variants[0].status = "ATIVO";
  for (const body of [{}, { status: false }, { status: "BLOQUEADO" }, { status: "INATIVO", estoque: 0 }, { status: "INATIVO", contaId: 2 }])
    await assert.rejects(alterarSituacaoProduto(d.db, 1, 101, body));
  await assert.rejects(alterarSituacaoProduto(d.db, 2, 101, { status: "INATIVO" }), { status: 404 });
  await assert.rejects(alterarSituacaoProduto(d.db, 1, 999, { status: "INATIVO" }), { status: 404 });
  d.db.produto.updateMany = async () => { throw new Error("Falha simulada"); };
  await assert.rejects(alterarSituacaoProduto(d.db, 1, 101, { status: "INATIVO" }), /Falha simulada/);
  assert.equal(d.state().bases[0].status, "ATIVO");
  assert.equal(d.state().variants[0].status, "ATIVO");
});

test("precisão e limites decimais: aceita frações e rejeita truncamento/overflow/pt-BR/NaN", () => {
  assert.equal(quantity.parse("0.250"), 0.25);
  assert.equal(quantity.parse("999999999.999"), 999999999.999);
  for (const value of ["0.0001", "1000000000", -1, null, "1,25", "1e2", Infinity, NaN, ""]) assert.equal(quantity.safeParse(value).success, false);
  assert.equal(money.safeParse("1.001").success, false);
  assert.equal(money.safeParse("100000000").success, false);
});
test("campos extras, alteração de estoque e custo omitido não são confundidos", () => {
  assert.equal(criarProdutoSchema.safeParse({ ...input, contaId: 2 }).success, false);
  for (const value of [{ estoque: 1 }, { precoPromocional: null }, { codigo: "X" }, { imagem: null }, {}]) assert.equal(editarProdutoSchema.safeParse(value).success, false);
  assert.deepEqual(editarProdutoSchema.parse({ precoCompra: null }), { precoCompra: null });
  assert.deepEqual(editarProdutoSchema.parse({ preco: 0 }), { preco: 0 });
});
test("criação reutiliza domínio, SKU, variante padrão, estoque fracionado e custo desconhecido", async () => {
  const d = database(); const result = await criarProduto(d.db, 1, input); const data = dataOf(result);
  assert.equal(result.replay, false);
  assert.equal(data.produtoBaseId, 101); assert.equal(data.varianteId, 201);
  const variant = d.state().variants[0];
  assert.equal(variant.produtoBaseId, 101); assert.equal(variant.contaId, 1);
  assert.equal(variant.estoque, .25); assert.equal(variant.minimo, .1); assert.equal(variant.ehPadrao, true); assert.equal(variant.controlaEstoque, true);
  assert.match(variant.codigo, /^CAFE-/); assert.equal(variant.precoCompra, undefined);
});
test("reenvio e duas criações simultâneas usam somente um cadastro; outro conteúdo conflita", async () => {
  const d = database();
  const result = await Promise.all([criarProduto(d.db, 1, input), criarProduto(d.db, 1, input)]);
  assert.deepEqual(dataOf(result[0]), dataOf(result[1])); assert.equal(d.state().bases.length, 1); assert.equal(d.state().variants.length, 1);
  assert.equal((await criarProduto(d.db, 1, input)).replay, true);
  await assert.rejects(criarProduto(d.db, 1, { ...input, nome: "Outro" }), { status: 409 });
});
test("chave é isolada por conta e categoria externa causa rollback completo", async () => {
  const d = database(); await criarProduto(d.db, 1, input); await criarProduto(d.db, 2, input);
  assert.equal(d.state().bases.length, 2);
  await assert.rejects(criarProduto(d.db, 3, { ...input, categoriaId: 9 }), { status: 404 });
  assert.equal(d.state().bases.length, 2); assert.equal(d.state().operations.length, 2);
});
test("falha após criar base reverte base e chave; retry cria somente um produto completo", async () => {
  const d = database(); const create = d.db.produto.create;
  d.db.produto.create = (async () => { throw new Error("falha de variante"); }) as any;
  await assert.rejects(criarProduto(d.db, 1, input));
  assert.equal(d.state().bases.length, 0); assert.equal(d.state().operations.length, 0);
  d.db.produto.create = create;
  await criarProduto(d.db, 1, input);
  assert.equal(d.state().bases.length, 1); assert.equal(d.state().variants.length, 1);
});
test("edição altera somente a variante selecionada e preserva fiscais/promoção/SKU/configurações/estoque", async () => {
  const d = database(); await criarProduto(d.db, 1, input);
  const first = d.state().variants[0]; Object.assign(first, { estoque: .125, ncm: "0901", precoPromocional: 30, codigo: "SKU-AVANCADO", mostrarNoPdv: false, mostrarNoCatalogo: false, producaoLocal: true, materiaPrima: true });
  const other = { ...first, id: 202, ehPadrao: false, preco: 50, nomeVariante: "500g" }; d.state().variants.push(other);
  const untouched = structuredClone(other); const before = structuredClone(first);
  await editarProduto(d.db, 1, 101, 201, { preco: "40.90", minimo: "0.025" });
  assert.deepEqual(first, { ...before, preco: 40.9, minimo: .025 }); assert.deepEqual(other, untouched);
  assert.ok(d.writes.some(w => w.lock));
});
test("edição comum sincroniza só campos explícitos, sem apagar descrição/categoria ausentes", async () => {
  const d = database(); await criarProduto(d.db, 1, { ...input, descricao: "Descrição anterior" });
  const v = d.state().variants[0]; d.state().variants.push({ ...v, id: 202, nomeVariante: "Outra", preco: 99 });
  await editarProduto(d.db, 1, 101, 201, { nome: "Nome novo" });
  assert.equal(d.state().bases[0].descricao, "Descrição anterior");
  assert.equal(d.state().variants[1].nome, "Nome novo"); assert.equal(d.state().variants[1].preco, 99);
  await editarProduto(d.db, 1, 101, 201, { descricao: null, precoCompra: 0 });
  assert.equal(v.descricao, null); assert.equal(v.precoCompra, 0); assert.equal(d.state().variants[1].precoCompra, undefined);
});
test("base/variante incorretas ou outra conta não são atualizadas", async () => {
  const d = database(); await criarProduto(d.db, 1, input);
  for (const args of [[2, 101, 201], [1, 102, 201], [1, 101, 999]]) {
    await assert.rejects(editarProduto(d.db, args[0], args[1], args[2], { preco: 10 }), { status: 404 });
  }
  assert.equal(d.state().variants[0].preco, 35.9);
});
test("reposição fracionada reutiliza entrada, sem financeiro e sem alterar custo/fiscal", async () => {
  const d = database(); await criarProduto(d.db, 1, input);
  await reporEstoque(d.db, 1, { produtoId: 201, quantidade: "0.125", custo: "20.50" });
  assert.equal(d.state().variants[0].estoque, .375); assert.equal(d.state().variants[0].precoCompra, undefined);
  assert.equal(d.state().movements.length, 1); assert.equal(d.state().movements[0].tipo, "ENTRADA"); assert.equal(d.state().movements[0].quantidade, .125);
  await assert.rejects(reporEstoque(d.db, 1, { produtoId: 201, quantidade: 1, custo: 10, fornecedor: 900 }), { status: 404 });
  assert.equal(d.state().movements.length, 1);
});
test("descarte respeita reservas/lock e não grava movimento se insuficiente", async () => {
  const d = database(); await criarProduto(d.db, 1, input); d.state().reserved = .125;
  await assert.rejects(descartarEstoque(d.db, 1, { produtoId: 201, quantidade: .25, motivo: "Avaria" }), { status: 409 });
  assert.equal(d.state().movements.length, 0); assert.equal(d.state().variants[0].estoque, .25);
  await descartarEstoque(d.db, 1, { produtoId: 201, quantidade: .125, motivo: "Avaria" });
  assert.equal(d.state().variants[0].estoque, .125); assert.equal(d.state().movements[0].tipo, "DESCARTE"); assert.equal(d.state().movements[0].notaFiscal, "Avaria");
  assert.ok(d.writes.some(w => w.lock));
});
test("criação Normal e Fácil chamam a mesma função mantendo campos avançados no Normal", async () => {
  const d = database();
  const data = ProdutoSchema.parse({ nome: "Produto Normal", preco: 12, estoque: 2, minimo: 1, precoCompra: 0, ncm: "0901" });
  const result = await d.db.$transaction(tx => criarProdutoBase(tx, 1, data, { ncm: data.ncm }));
  assert.equal(result.nome, "Produto Normal"); assert.equal(result.variantes[0].ncm, "0901"); assert.equal(result.variantes[0].estoque, 2);
});
