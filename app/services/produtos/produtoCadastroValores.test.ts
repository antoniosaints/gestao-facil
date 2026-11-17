import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma } from '../../../generated';
import { criarProdutoBase } from './produtoCadastroService';

for (const promocional of [1199.99, undefined]) {
  test(`cadastro base preserva preços e frações (promocional ${promocional ?? 'vazio'})`, async () => {
    let variante: Record<string, unknown> | undefined;
    const tx = {
      produtoBase: { create: async () => ({ id: 1 }), findUniqueOrThrow: async () => ({ id: 1, variantes: [variante] }) },
      produto: { create: async ({ data }: { data: Record<string, unknown> }) => { variante = data; return data } },
    } as unknown as Prisma.TransactionClient;
    const data = { nome: 'Produto QA', codigo: 'QA-00123', preco: 1234.56, precoPromocional: promocional, precoCompra: 789.12, estoque: 12.345, minimo: 0.125 } as Parameters<typeof criarProdutoBase>[2];
    await criarProdutoBase(tx, 1, data);
    assert.equal(variante?.preco, 1234.56);
    assert.equal(variante?.precoPromocional, promocional ?? null);
    assert.equal(variante?.precoCompra, 789.12);
    assert.equal(variante?.estoque, 12.345);
    assert.equal(variante?.minimo, 0.125);
    assert.equal(variante?.codigo, 'QA-00123');
  });
}
