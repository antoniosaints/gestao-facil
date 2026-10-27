import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPeopleWhere } from '../../controllers/clientes/queryFilters';

test('busca de fornecedor filtra tipo antes da contagem e da paginação sem perder o escopo da conta', () => {
  assert.deepEqual(buildPeopleWhere(9, { tipo: 'FORNECEDOR', search: ' F123 ', status: 'ATIVO' }), {
    contaId: 9,
    tipo: 'FORNECEDOR',
    OR: [{ nome: { contains: 'F123' } }, { Uid: { contains: 'F123' } }],
    status: 'ATIVO',
  });
  assert.equal(buildPeopleWhere(9, { tipo: 'CLIENTE' }).tipo, 'CLIENTE');
});

test('listagem sem restrição de tipo mantém clientes e fornecedores e ignora filtros de tipo inválidos', () => {
  for (const tipo of [undefined, '', 'TODOS', { not: 'CLIENTE' }]) {
    assert.deepEqual(buildPeopleWhere(9, { tipo }), { contaId: 9 });
  }
});
