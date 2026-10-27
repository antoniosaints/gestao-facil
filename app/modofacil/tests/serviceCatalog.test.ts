import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServiceWhere } from '../../controllers/servicos/queryFilters';
import { servicoSchema } from '../adapters/schemas';
import { editarServicoBasico } from '../operacoes/cadastros';

test('filtro de serviços converte as situações para boolean e conserva a conta e a busca', () => {
  for (const value of [false, 'false', '0', 'INATIVO']) assert.deepEqual(buildServiceWhere(3,{status:value}),{contaId:3,status:false});
  for (const value of [true, 'true', '1', 'ATIVO']) assert.deepEqual(buildServiceWhere(3,{status:value}),{contaId:3,status:true});
  assert.deepEqual(buildServiceWhere(3,{status:'',search:'  rede  '}),{contaId:3,OR:[{nome:{contains:'rede'}},{Uid:{contains:'rede'}},{descricao:{contains:'rede'}}]});
});
test('cadastro aceita serviço inativo e rejeita situação inválida e campos fiscais', () => {
  assert.deepEqual(servicoSchema.parse({nome:'Reparo',preco:'25,00'.replace(',','.'),status:false}),{nome:'Reparo',preco:25,status:false});
  for(const extra of [{status:'false'},{contaId:9},{ncm:'0901'}]) assert.equal(servicoSchema.safeParse({nome:'Reparo',preco:25,...extra}).success,false);
});
test('edição de nome e situação é única, parcial e restrita à conta, sem sobrescrever preço nem fiscal', async()=>{
  const calls:any[]=[];
  const db:any={servicos:{updateMany:async(query:any)=>{calls.push(query);return {count:query.where.contaId===3?1:0};},findFirst:async()=>({id:7,nome:'Revisão',status:false,preco:25,ncm:'0901'})}};
  const result=await editarServicoBasico(db,3,7,{nome:'Revisão',status:false});
  assert.deepEqual(calls[0],{where:{id:7,contaId:3},data:{nome:'Revisão',status:false}});
  assert.equal(result?.preco,25);assert.equal(result?.ncm,'0901');
  await assert.rejects(editarServicoBasico(db,9,7,{status:true}),{status:404});
  await assert.rejects(editarServicoBasico(db,3,7,{ncm:'123'}));
});
