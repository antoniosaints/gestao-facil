import { test } from "node:test";
import assert from "node:assert/strict";
import { editingDatabase } from "./edicaoFixtures";
import { carregarEdicao, editarOperacao } from "../operacoes/edicao";
import { subHours } from "date-fns";

const session = { contaId: 1, userId: 10, permissao: "admin", email: "example@example.test", contaStatus: "ATIVO" };
test("edição de observação preserva item, estoque, caixa, comanda, garantia e data", async () => {
  const d = editingDatabase(), before = structuredClone(d.state()); const snapshot = await carregarEdicao(d.db, 1, 301, "venda");
  const result = await editarOperacao(d.db, session, 301, "venda", { revisao: snapshot.revisao, observacoes: "Atualizada" }, d.ports);
  assert.equal((result.registro as any).observacoes, "Atualizada"); assert.notEqual(result.revisao, snapshot.revisao);
  assert.deepEqual(d.state().saleItems, before.saleItems); assert.deepEqual(d.state().variants, before.variants); assert.deepEqual(d.state().movements, before.movements);
  assert.deepEqual(d.state().sales[0], { ...before.sales[0], observacoes: "Atualizada" });
});
test("editar itens reutiliza devolução/rebaixa uma vez e mantém campos omitidos", async () => {
  const d = editingDatabase(); const snapshot = await carregarEdicao(d.db, 1, 301, "venda");
  await editarOperacao(d.db, session, 301, "venda", { revisao: snapshot.revisao, itens: [{ id: 201, tipo: "PRODUTO", nome: "Café", preco: 10, quantidade: 3 }] }, d.ports);
  assert.equal(d.state().variants[0].estoque, 7); assert.equal(d.state().saleItems.length, 1); assert.equal(d.state().saleItems[0].quantidade, 3);
  assert.equal(d.state().movements.length, 1); assert.equal(d.state().movements[0].quantidade, 3);
  assert.equal(d.state().sales[0].vendedorId, null); assert.equal(d.state().sales[0].garantia, null); assert.equal(d.state().sales[0].caixaId, 88);
  assert.equal(d.state().sales[0].data.toISOString(), "2026-10-26T15:00:00.000Z");
});
test("revisão concorrente e faturamento impedem sobrescrita e movimentos repetidos", async () => {
  const d = editingDatabase(); const snapshot = await carregarEdicao(d.db, 1, 301, "venda");
  const results = await Promise.allSettled([editarOperacao(d.db, session, 301, "venda", { revisao: snapshot.revisao, observacoes: "A" }, d.ports), editarOperacao(d.db, session, 301, "venda", { revisao: snapshot.revisao, observacoes: "B" }, d.ports)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason.status, 409);
  d.state().sales[0].faturado = true;
  const paid = await carregarEdicao(d.db, 1, 301, "venda");
  await assert.rejects(editarOperacao(d.db, session, 301, "venda", { revisao: paid.revisao, observacoes: "C" }, d.ports), { status: 409 });
});
test("vínculos financeiros/fiscais permitem só observação, sem alterar estoque", async () => {
  const d = editingDatabase(); d.state().finance.push({ id: 1, status: "PENDENTE" });
  const snapshot = await carregarEdicao(d.db, 1, 301, "venda");
  await assert.rejects(editarOperacao(d.db, session, 301, "venda", { revisao: snapshot.revisao, desconto: 1 }, d.ports), { code: "linked_finance" });
  await editarOperacao(d.db, session, 301, "venda", { revisao: snapshot.revisao, observacoes: null }, d.ports);
  assert.equal(d.state().sales[0].observacoes, null); assert.equal(d.state().variants[0].estoque, 8);
});
test("estoque insuficiente reverte devolução, itens e movimentos da edição", async () => {
  const d = editingDatabase(); const snapshot = await carregarEdicao(d.db, 1, 301, "venda"); const before = structuredClone(d.state());
  await assert.rejects(editarOperacao(d.db, session, 301, "venda", { revisao: snapshot.revisao, itens: [{ id: 201, tipo: "PRODUTO", preco: 10, quantidade: 99 }] }, d.ports));
  assert.deepEqual(d.state(), before);
});
test("produto ou conta externa rejeita edição antes de chamar mutação", async () => {
  const d = editingDatabase(); const snapshot = await carregarEdicao(d.db, 1, 301, "venda");
  await assert.rejects(editarOperacao(d.db, session, 301, "venda", { revisao: snapshot.revisao, itens: [{ id: 999, tipo: "PRODUTO", preco: 10, quantidade: 1 }] }, d.ports), { code: "invalid_item" });
  await assert.rejects(carregarEdicao(d.db, 2, 301, "venda"), { status: 404 }); assert.equal(d.state().variants[0].estoque, 8);
});
test("vendedor só edita venda própria e não transfere autoria por payload", async () => {
  const d = editingDatabase(); const seller = { ...session, permissao: "vendedor" };
  let snapshot = await carregarEdicao(d.db, 1, 301, "venda");
  await assert.rejects(editarOperacao(d.db, seller, 301, "venda", { revisao: snapshot.revisao, observacoes: "Fora" }, d.ports), { status: 403 });
  d.state().sales[0].vendedorId = 10; snapshot = await carregarEdicao(d.db, 1, 301, "venda");
  await assert.rejects(editarOperacao(d.db, seller, 301, "venda", { revisao: snapshot.revisao, vendedorId: 11 }, d.ports), { status: 403 });
  await editarOperacao(d.db, seller, 301, "venda", { revisao: snapshot.revisao, observacoes: "Própria" }, d.ports);
  assert.equal(d.state().sales[0].observacoes, "Própria");
});
test("OS altera itens sem apagar descrição, data ou garantia textual legada", async () => {
  const d = editingDatabase(); d.state().movements = [{ id: 701, contaId: 1, ordemId: 401, produtoId: 201, tipo: "SAIDA", quantidade: 2 }];
  const snapshot = await carregarEdicao(d.db, 1, 401, "os");
  await editarOperacao(d.db, session, 401, "os", { revisao: snapshot.revisao, itens: [{ id: 201, tipo: "PRODUTO", nome: "Material", valor: 10, quantidade: 3 }] }, d.ports);
  assert.equal(d.state().orders[0].garantia, "90 dias de cobertura"); assert.equal(d.state().orders[0].descricao, "Descrição antiga"); assert.equal(d.state().variants[0].estoque, 7);
  assert.equal(d.state().orders[0].data.toISOString(), "2026-10-26T15:00:00.000Z");
});
test("edição Fácil e operação compartilhada do Normal produzem mesmo saldo/itens/total", async () => {
  const a = editingDatabase(), b = editingDatabase(); const snapshot = await carregarEdicao(a.db, 1, 301, "venda");
  const itens = [{ id: 201, tipo: "PRODUTO" as const, nome: "Café", preco: 12, quantidade: 3 }];
  await editarOperacao(a.db, session, 301, "venda", { revisao: snapshot.revisao, itens, desconto: 2 }, a.ports);
  await b.db.$transaction(tx => b.ports.venda(tx, 301, { data: subHours(b.state().sales[0].data, 3), clienteId: null, vendedorId: null, observacoes: "Anterior", garantia: undefined, desconto: 2, comandaId: null, status: "PENDENTE", itens, pagamento: "OUTRO", tipoDocumentoFiscal: "NENHUM" }, session));
  assert.equal(a.state().variants[0].estoque, b.state().variants[0].estoque);
  assert.equal(String(a.state().sales[0].valor), String(b.state().sales[0].valor)); assert.deepEqual(a.state().saleItems, b.state().saleItems);
});
