import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGeranetCities, searchGeranetCities, usesNationalNfse } from './geranetCities';
const result = { situacao: 'sucesso', registros: [{ codigoIbge: 1702109, nome: 'Araguaína', uf: 'to', provedor: 'PadraoNacional', versao: '1.01' }] };
test('consulta cidades na rota pública com sessão/CSRF, sem autenticação fiscal', async () => {
  const calls: any[] = [];
  const transport: any = { get: async (...args: any[]) => { calls.push(args); return { data: '<meta content="public-csrf" name="csrf-token">', headers: { 'set-cookie': ['session=abc; HttpOnly', 'XSRF-TOKEN=def; Path=/'] } }; }, post: async (...args: any[]) => { calls.push(args); return { data: result }; } };
  const cities = await searchGeranetCities('https://nfe.geranet.net/api/v1', ' 1702109 ', 30, transport);
  assert.equal(calls[0][0], 'https://nfe.geranet.net/');
  assert.equal(calls[1][0], 'https://nfe.geranet.net/nfse/cidades/consultar');
  assert.deepEqual(calls[1][1], { nome: '1702109', limite: 30 });
  assert.equal(calls[1][2].headers.Cookie, 'session=abc; XSRF-TOKEN=def');
  assert.equal(calls[1][2].headers['X-CSRF-TOKEN'], 'public-csrf');
  assert.equal(calls[1][2].headers.Authorization, undefined);
  assert.equal(cities[0].codigoIbge, '1702109'); assert.equal(cities[0].uf, 'TO');
  assert.equal(usesNationalNfse(cities[0]), true); assert.equal(usesNationalNfse({ provedor: 'EL' }), false);
});
test('renova a sessão apenas uma vez quando o CSRF expira', async () => {
  let pages = 0, posts = 0;
  const transport: any = { get: async () => { pages++; return { data: `fetch('/nfse/cidades/consultar', {headers: {'X-CSRF-TOKEN': 'inlineToken'}})`, headers: { 'set-cookie': ['session=abc'] } }; }, post: async () => { posts++; if (posts === 1) throw { response: { status: 419 } }; return { data: result }; } };
  assert.equal((await searchGeranetCities('https://nfe.geranet.net/api/v1', 'Araguaína', 30, transport)).length, 1);
  assert.equal(pages, 2); assert.equal(posts, 2);
});
test('resposta inválida e cidades malformadas não viram cobertura de emissão', async () => {
  assert.throws(() => normalizeGeranetCities({ situacao: 'erro', registros: [] }), /inválida/);
  assert.deepEqual(normalizeGeranetCities({ situacao: 'sucesso', registros: [{ nome: 'Cidade', codigoIbge: '12', uf: 'TO' }] }), []);
  await assert.rejects(searchGeranetCities('https://nfe.geranet.net/api/v1', 'a'), /2 a 120/);
  await assert.rejects(searchGeranetCities('https://nfe.geranet.net/api/v1', 'cidade', 51), /1 a 50/);
});
