-- AlterTable
ALTER TABLE `Contas`
ADD COLUMN `valorBasePlano` DECIMAL(10, 2) NOT NULL DEFAULT 70.00;

UPDATE `Contas`
SET `valorBasePlano` = `valor`
WHERE `valorBasePlano` = 70.00;

-- AlterTable
ALTER TABLE `ModulosAdicionais`
ADD COLUMN `codigo` VARCHAR(191) NOT NULL DEFAULT '';

UPDATE `ModulosAdicionais`
SET `codigo` = CASE
  WHEN LOWER(`nome`) LIKE '%core ia%' THEN 'core-ia'
  WHEN LOWER(`nome`) LIKE '%whatsapp%' THEN 'whatsapp'
  ELSE CONCAT('modulo-', `id`)
END
WHERE `codigo` = '';

ALTER TABLE `ModulosAdicionais`
ADD CONSTRAINT `ModulosAdicionais_codigo_key` UNIQUE (`codigo`);

-- AlterTable
ALTER TABLE `ModuloOnConta`
ADD COLUMN `ativoDesde` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
ADD COLUMN `canceladoEm` DATETIME(3) NULL,
ADD COLUMN `solicitadoCancelamentoEm` DATETIME(3) NULL,
ADD COLUMN `status` ENUM('ATIVO', 'CANCELAMENTO_AGENDADO', 'CANCELADO') NOT NULL DEFAULT 'ATIVO',
ADD COLUMN `valorAdicional` DECIMAL(10, 2) NOT NULL DEFAULT 0.00;

UPDATE `ModuloOnConta` moc
INNER JOIN `ModulosAdicionais` ma ON ma.`id` = moc.`moduloId`
SET
  moc.`valorAdicional` = ma.`preco`,
  moc.`ativoDesde` = moc.`createdAt`,
  moc.`status` = 'ATIVO';
