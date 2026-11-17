import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProdutoSchema } from './produtos';
for (const field of ['estoque', 'minimo'] as const) {
  test(`${field}: cadastro comum preserva frações e números inteiros`, () => {
    const schema = ProdutoSchema.shape[field];
    for (const [input, expected] of [[12.345, 12.345], ['0,125', 0.125], [0, 0], [12, 12]]) {
      assert.equal(schema.parse(input), expected);
    }
    for (const value of [-1, 0.1234, 1_000_000_000, Infinity, '', undefined]) {
      assert.equal(schema.safeParse(value).success, false, `${String(value)} deve ser rejeitado`);
    }
  });
}
