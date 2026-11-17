import assert from 'node:assert/strict'
import {it} from 'node:test'
import {addDays} from 'date-fns'
import {assertFutureSettlementAllowed,assertLancamentoDateAllowed,getFinanceiroFeatureFlags} from './financeiroPolicyService'

it('valida datas na conexão transacional sem ignorar as políticas da conta',async()=>{
  const db:any={parametrosConta:{findUnique:async({where}:any)=>{assert.equal(where.contaId,17);return{permitirLancamentoRetroativo:false,permitirEfetivacaoFutura:false}}}}
  await assert.rejects(assertLancamentoDateAllowed(17,addDays(new Date(),-1),db),/retroativa/)
  await assert.rejects(assertFutureSettlementAllowed(17,[addDays(new Date(),1)],db),/futura/)
  await assertLancamentoDateAllowed(17,new Date(),db)
})
it('preserva permissões explícitas e valores padrão ao consultar flags na transação',async()=>{
  const db:any={parametrosConta:{findUnique:async()=>null}}
  assert.equal((await getFinanceiroFeatureFlags(1,db)).permitirLancamentoRetroativo,true)
  await assertFutureSettlementAllowed(1,[addDays(new Date(),1)],db)
})
