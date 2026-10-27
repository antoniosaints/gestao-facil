import { test } from "node:test";
import assert from "node:assert/strict";
import { lancamentoSchema, lancamentoBasicoSchema, pessoaPatchSchema, servicoSchema } from "../adapters/schemas";

test("lançamento manual não aceita vínculos automáticos nem repetição de id de venda/OS", () => {
  const input = { chaveOperacao: "9509e4e7-776a-4f30-b4e7-215a003d1341", descricao: "Aluguel", tipo: "DESPESA", valorTotal: "100.50", dataLancamento: "2026-10-26T12:00:00-03:00", formaPagamento: "PIX", lancamentoEfetivado: false, categoriaId: 2 };
  assert.equal(lancamentoSchema.parse(input).valorTotal, 100.5);
  for (const extra of [{ vendaId: 9 }, { ordemId: 5 }, { contaId: 2 }, { id: 10 }, { valorTotal: "100.001" }]) assert.equal(lancamentoSchema.safeParse({ ...input, ...extra }).success, false);
});
test("edição parcial de pessoas preserva omissões e permite limpar documento explicitamente; serviço rejeita campos avançados e conta", () => {
  assert.deepEqual(pessoaPatchSchema.parse({ nome: "Maria" }), { nome: "Maria" });
  assert.deepEqual(pessoaPatchSchema.parse({ nome: "Maria", documento: "" }), { nome: "Maria", documento: "" });
  assert.equal(pessoaPatchSchema.safeParse({ nome: "Maria", contaId: 2 }).success, false);
  assert.deepEqual(servicoSchema.parse({ nome: "Reparo", preco: "10.50" }), { nome: "Reparo", preco: 10.5 });
  assert.equal(servicoSchema.safeParse({ nome: "Reparo", preco: 10, ncm: null }).success, false);
});
test("atualização financeira exige clienteId explícito para não limpar vínculo omitido", () => {
  const data = { descricao: "Conta", dataLancamento: "2026-10-26T00:00:00Z", categoriaId: 1, contasFinanceiroId: 2, formaPagamento: "PIX" };
  assert.equal(lancamentoBasicoSchema.safeParse(data).success, false);
  assert.equal(lancamentoBasicoSchema.safeParse({ ...data, clienteId: 3 }).success, true);
  assert.equal(lancamentoBasicoSchema.safeParse({ ...data, clienteId: null }).success, true);
});
