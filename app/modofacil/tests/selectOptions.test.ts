import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectOptions } from '../operacoes/selectOptions';
function db(rows: { id: number; nome: string }[] = []) {
  const calls: any[] = [];
  const model = (kind: string) => ({ findMany: async (args: any) => { calls.push({ kind, ...args }); return rows; } });
  return { calls, client: { contasFinanceiro: model('account'), categoriaFinanceiro: model('finance-category'), produtoCategoria: model('product-category') } as any };
}
test('opções financeiras limitam a consulta, preservam a conta e paginam sem materializar todo o catálogo', async () => {
  const { client, calls } = db(Array.from({ length: 21 }, (_, i) => ({ id: 30 + i, nome: `Categoria ${i}` })));
  const result = await selectOptions(client, 9, 'finance-categories', { page: '2', search: 'Aluguel', excludeId: '3' });
  assert.equal(result.results.length, 20);
  assert.equal(result.hasMore, true);
  assert.deepEqual(calls[0], { kind: 'finance-category', where: { contaId: 9, NOT: { id: 3 }, OR: [{ nome: { contains: 'Aluguel' } }, { Uid: { contains: 'Aluguel' } }] }, select: { id: true, nome: true }, orderBy: [{ nome: 'asc' }, { id: 'asc' }], skip: 20, take: 21 });
});
test('busca por ID carrega a seleção fora da primeira página com escopo da conta', async () => {
  const { client, calls } = db([{ id: 120, nome: 'Categoria antiga' }]);
  const result = await selectOptions(client, 9, 'product-categories', { id: '120', page: '30', search: 'outro nome' });
  assert.deepEqual(calls[0].where, { contaId: 9, id: 120 });
  assert.equal(calls[0].skip, 0);
  assert.equal(calls[0].take, 1);
  assert.deepEqual(result, { results: [{ id: 120, label: 'Categoria antiga' }], hasMore: false });
});
test('contas usam projeção mínima e IDs inválidos são rejeitados', async () => {
  const { client, calls } = db();
  assert.deepEqual(await selectOptions(client, 9, 'finance-accounts', { page: '-5' }), { results: [], hasMore: false });
  assert.equal(calls[0].skip, 0);
  assert.equal(calls[0].kind, 'account');
  await assert.rejects(() => selectOptions(client, 9, 'finance-categories', { id: 'inválido' }));
  await assert.rejects(() => selectOptions(client, 9, 'finance-categories', { search: 'x'.repeat(200) }));
  assert.equal(calls.length, 1);
});
