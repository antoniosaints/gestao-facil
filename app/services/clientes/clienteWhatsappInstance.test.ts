import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveClienteWhatsappInstance } from './clienteWhatsappInstance'

const instances = [{ id: 1, contaId: 10, ativo: true, status: 'CONECTADA' }, { id: 2, contaId: 10, ativo: true, status: 'DESCONECTADA' }, { id: 3, contaId: 20, ativo: true, status: 'CONECTADA' }]
function repository(defaultId: number | null = null) {
  return {
    moduleActive: async () => true,
    defaultInstance: async () => defaultId,
    findInstance: async (where: { id: number; contaId: number; ativo: true }) => instances.find(instance => instance.id === where.id && instance.contaId === where.contaId && instance.ativo === where.ativo) ?? null,
  }
}
describe('seleção da instância de envio ao cliente', () => {
  it('permite escolher uma instância sem principal configurada', async () => {
    const selected = await resolveClienteWhatsappInstance(10, 1, repository())
    assert.equal(selected.id, 1)
  })
  it('mantém a principal como fallback para os clientes antigos da API', async () => {
    assert.equal((await resolveClienteWhatsappInstance(10, undefined, repository(1))).id, 1)
  })
  it('prioriza a escolha explícita sem alterar ou consultar a configuração principal', async () => {
    const repo = repository(2)
    repo.defaultInstance = async () => { throw new Error('Não deve ler a principal') }
    assert.equal((await resolveClienteWhatsappInstance(10, 1, repo)).id, 1)
  })
  it('recusa uma instância de outra conta', async () => {
    await assert.rejects(resolveClienteWhatsappInstance(10, 3, repository()), { code: 'whatsapp_instance_not_found', status: 404 })
  })
  it('recusa instâncias desconectadas e seleção ausente', async () => {
    await assert.rejects(resolveClienteWhatsappInstance(10, 2, repository()), { code: 'whatsapp_instance_disconnected' })
    await assert.rejects(resolveClienteWhatsappInstance(10, undefined, repository()), { code: 'whatsapp_instance_required' })
  })
  it('bloqueia envio quando o app estiver inativo antes de procurar a instância', async () => {
    const repo = repository(1)
    repo.moduleActive = async () => false
    repo.findInstance = async () => { throw new Error('Não deve consultar a instância') }
    await assert.rejects(resolveClienteWhatsappInstance(10, 1, repo), { code: 'whatsapp_module_inactive', status: 403 })
  })
})
