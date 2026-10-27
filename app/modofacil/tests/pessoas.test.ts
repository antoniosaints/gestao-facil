import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editarPessoa } from '../pessoas';
import { pessoaSchema, pessoaPatchSchema } from '../adapters/schemas';

test('pessoa altera tipo e situação na mesma atualização restrita à conta, preservando campos omitidos', async () => {
  const calls: any[] = [];
  const db: any = { clientesFornecedores: {
    updateMany: async (query: any) => { calls.push(query); return {count:1}; },
    findFirst: async (query: any) => { calls.push(query); return {id:7, nome:'Ana',tipo:'FORNECEDOR',status:'INATIVO'}; },
  }};
  const result = await editarPessoa(db, 3, 7, {tipo:'FORNECEDOR',status:'INATIVO'});
  assert.equal(result?.tipo, 'FORNECEDOR');
  assert.deepEqual(calls, [{where:{id:7,contaId:3},data:{tipo:'FORNECEDOR',status:'INATIVO'}},{where:{id:7,contaId:3}}]);
});
test('ação rápida envia apenas situação e não substitui nome, tipo ou contato', async () => {
  const calls: any[] = [];
  const db: any = {clientesFornecedores:{updateMany:async (query:any)=>{calls.push(query);return {count:1};},findFirst:async()=>({id:7})}};
  await editarPessoa(db, 2, 7, {status:'ATIVO'});
  assert.deepEqual(calls[0].data, {status:'ATIVO'});
  for (const input of [{contaId:9,status:'INATIVO'},{id:8},{tipo:'OUTRO'},{status:'REMOVIDO'},{documento:'123'},{cep:'123'},{}]) {
    await assert.rejects(editarPessoa(db, 2, 7, input));
  }
  assert.equal(calls.length, 1);
});
test('cadastro aceita documento/endereço/WhatsApp e normaliza CPF e CEP; PATCH não adiciona valores padrão', () => {
  const data = pessoaSchema.parse({nome:'  Ana  ',tipo:'FORNECEDOR',status:'INATIVO',whastapp:'11999990000',documento:'529.982.247-25',cep:'86000-000',endereco:'Rua Um',numero:'120',ie:'ISENTO'});
  assert.equal(data.nome, 'Ana'); assert.equal(data.documento,'52998224725'); assert.equal(data.cep,'86000000'); assert.equal(data.ie,'ISENTO');
  assert.deepEqual(pessoaPatchSchema.parse({telefone:null}),{telefone:null});
  assert.equal(pessoaSchema.safeParse({...data,contaId:9}).success,false);
  assert.equal(pessoaSchema.safeParse({...data,documento:'CPF inválido'}).success,false);
});
test('edição de registro ausente ou de outra conta não consulta nem retorna outra pessoa', async () => {
  const queries: any[] = []; let reads = 0;
  const db: any = {clientesFornecedores:{updateMany:async (query:any)=>{queries.push(query);return {count:0};},findFirst:async()=>{reads++;return null;}}};
  await assert.rejects(editarPessoa(db, 2, 99, {nome:'Ana'}), {status:404});
  assert.deepEqual(queries[0].where,{id:99,contaId:2}); assert.equal(reads,0);
});
