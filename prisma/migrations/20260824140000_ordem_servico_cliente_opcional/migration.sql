-- Ordens de ourivesaria podem ser registradas antes da identificação do cliente.
-- A alteração é retrocompatível: vínculos existentes permanecem inalterados.
ALTER TABLE `OrdensServico` MODIFY `clienteId` INTEGER NULL;
