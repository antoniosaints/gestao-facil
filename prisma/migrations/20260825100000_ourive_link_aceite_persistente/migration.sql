-- Mantém o endereço público do aceite disponível na OS para consulta e comprovação posterior.
ALTER TABLE `OuriveOrcamento`
  ADD COLUMN `tokenPublico` VARCHAR(128) NULL;
