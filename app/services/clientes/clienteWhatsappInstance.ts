type InstanceWhere = { id: number; contaId: number; ativo: true }
type Sender = { id: number; status: string }

class SenderSelectionError extends Error {
  constructor(message: string, public code: string, public status = 422) { super(message) }
}

export async function resolveClienteWhatsappInstance<T extends Sender>(
  contaId: number,
  instanciaId: number | undefined,
  repository: {
    moduleActive: (contaId: number) => Promise<boolean>
    defaultInstance: (contaId: number) => Promise<number | null>
    findInstance: (where: InstanceWhere) => Promise<T | null>
  },
): Promise<T> {
  if (!(await repository.moduleActive(contaId))) {
    throw new SenderSelectionError('Ative o app WhatsApp para enviar mensagens.', 'whatsapp_module_inactive', 403)
  }
  const id = instanciaId ?? await repository.defaultInstance(contaId)
  if (!id || !Number.isSafeInteger(id) || id < 1) {
    throw new SenderSelectionError('Selecione uma instância de WhatsApp para o envio.', 'whatsapp_instance_required')
  }
  const instance = await repository.findInstance({ id, contaId, ativo: true })
  if (!instance) {
    throw new SenderSelectionError('Instância de WhatsApp não encontrada para esta conta.', 'whatsapp_instance_not_found', 404)
  }
  if (instance.status !== 'CONECTADA') {
    throw new SenderSelectionError('A instância selecionada precisa estar conectada para enviar mensagens.', 'whatsapp_instance_disconnected')
  }
  return instance
}
