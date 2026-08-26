-- Esta migration pode ser retomada depois de uma execução interrompida: a primeira
-- versão assumia nomes de índices gerados pelo Prisma que não existem em todas as
-- bases antigas. Cada DDL é protegido para acomodar tanto o estado original quanto
-- o estado parcialmente aplicado.

-- Uma conta passa a ter várias promoções (antes havia um UNIQUE em contaId).
SET @index_name = (
  SELECT `INDEX_NAME`
  FROM information_schema.`STATISTICS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'RestauranteFidelidadePrograma'
    AND `NON_UNIQUE` = 0
  GROUP BY `INDEX_NAME`
  HAVING GROUP_CONCAT(`COLUMN_NAME` ORDER BY `SEQ_IN_INDEX` SEPARATOR ',') = 'contaId'
  LIMIT 1
);
SET @statement = IF(@index_name IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `RestauranteFidelidadePrograma` DROP INDEX `', REPLACE(@index_name, '`', '``'), '`'));
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

-- O progresso e o lançamento passam a apontar para a promoção correspondente.
SET @statement = IF(
  EXISTS(SELECT 1 FROM information_schema.`COLUMNS` WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'RestauranteFidelidadeProgresso' AND `COLUMN_NAME` = 'programaId'),
  'SELECT 1',
  'ALTER TABLE `RestauranteFidelidadeProgresso` ADD COLUMN `programaId` INTEGER NULL'
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @statement = IF(
  EXISTS(SELECT 1 FROM information_schema.`COLUMNS` WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'RestauranteFidelidadeLancamento' AND `COLUMN_NAME` = 'programaId'),
  'SELECT 1',
  'ALTER TABLE `RestauranteFidelidadeLancamento` ADD COLUMN `programaId` INTEGER NULL'
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

UPDATE `RestauranteFidelidadeProgresso` AS progresso
INNER JOIN `RestauranteFidelidadePrograma` AS programa ON programa.`contaId` = progresso.`contaId`
SET progresso.`programaId` = programa.`id`
WHERE progresso.`programaId` IS NULL;

UPDATE `RestauranteFidelidadeLancamento` AS lancamento
INNER JOIN `RestauranteFidelidadePrograma` AS programa ON programa.`contaId` = lancamento.`contaId`
SET lancamento.`programaId` = programa.`id`
WHERE lancamento.`programaId` IS NULL;

ALTER TABLE `RestauranteFidelidadeProgresso` MODIFY COLUMN `programaId` INTEGER NOT NULL;
ALTER TABLE `RestauranteFidelidadeLancamento` MODIFY COLUMN `programaId` INTEGER NOT NULL;

-- Remove qualquer UNIQUE antigo equivalente, sem depender do nome do índice.
SET @index_name = (
  SELECT `INDEX_NAME`
  FROM information_schema.`STATISTICS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'RestauranteFidelidadeProgresso'
    AND `NON_UNIQUE` = 0
  GROUP BY `INDEX_NAME`
  HAVING GROUP_CONCAT(`COLUMN_NAME` ORDER BY `SEQ_IN_INDEX` SEPARATOR ',') = 'contaId,telefoneNormalizado'
  LIMIT 1
);
SET @statement = IF(@index_name IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `RestauranteFidelidadeProgresso` DROP INDEX `', REPLACE(@index_name, '`', '``'), '`'));
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

-- O FK de Pedido usa pedidoId. O novo índice composto precisa existir antes de
-- remover o UNIQUE antigo, pois ele também satisfaz a indexação dessa FK.
SET @statement = IF(
  EXISTS(SELECT 1 FROM information_schema.`STATISTICS` WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'RestauranteFidelidadeLancamento' AND `INDEX_NAME` = 'rest_fid_launch_order_prog_uq'),
  'SELECT 1',
  'ALTER TABLE `RestauranteFidelidadeLancamento` ADD UNIQUE INDEX `rest_fid_launch_order_prog_uq` (`pedidoId`, `programaId`)'
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @index_name = (
  SELECT `INDEX_NAME`
  FROM information_schema.`STATISTICS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'RestauranteFidelidadeLancamento'
    AND `NON_UNIQUE` = 0
  GROUP BY `INDEX_NAME`
  HAVING GROUP_CONCAT(`COLUMN_NAME` ORDER BY `SEQ_IN_INDEX` SEPARATOR ',') = 'pedidoId'
  LIMIT 1
);
SET @statement = IF(@index_name IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `RestauranteFidelidadeLancamento` DROP INDEX `', REPLACE(@index_name, '`', '``'), '`'));
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @statement = IF(
  EXISTS(SELECT 1 FROM information_schema.`STATISTICS` WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'RestauranteFidelidadeProgresso' AND `INDEX_NAME` = 'rest_fid_prog_phone_uq'),
  'SELECT 1',
  'ALTER TABLE `RestauranteFidelidadeProgresso` ADD UNIQUE INDEX `rest_fid_prog_phone_uq` (`programaId`, `telefoneNormalizado`)'
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @statement = IF(
  EXISTS(SELECT 1 FROM information_schema.`STATISTICS` WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'RestauranteFidelidadeProgresso' AND `INDEX_NAME` = 'rest_fid_prog_rewards_idx'),
  'SELECT 1',
  'ALTER TABLE `RestauranteFidelidadeProgresso` ADD INDEX `rest_fid_prog_rewards_idx` (`contaId`, `programaId`, `recompensasDisponiveis`)'
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @statement = IF(
  EXISTS(SELECT 1 FROM information_schema.`STATISTICS` WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'RestauranteFidelidadeLancamento' AND `INDEX_NAME` = 'rest_fid_launch_order_prog_uq'),
  'SELECT 1',
  'ALTER TABLE `RestauranteFidelidadeLancamento` ADD UNIQUE INDEX `rest_fid_launch_order_prog_uq` (`pedidoId`, `programaId`)'
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @statement = IF(
  EXISTS(SELECT 1 FROM information_schema.`STATISTICS` WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'RestauranteFidelidadeLancamento' AND `INDEX_NAME` = 'rest_fid_launch_prog_idx'),
  'SELECT 1',
  'ALTER TABLE `RestauranteFidelidadeLancamento` ADD INDEX `rest_fid_launch_prog_idx` (`contaId`, `programaId`, `progressoId`)'
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @statement = IF(
  EXISTS(SELECT 1 FROM information_schema.`TABLE_CONSTRAINTS` WHERE `CONSTRAINT_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'RestauranteFidelidadeProgresso' AND `CONSTRAINT_NAME` = 'RestauranteFidelidadeProgresso_programaId_fkey' AND `CONSTRAINT_TYPE` = 'FOREIGN KEY'),
  'SELECT 1',
  'ALTER TABLE `RestauranteFidelidadeProgresso` ADD CONSTRAINT `RestauranteFidelidadeProgresso_programaId_fkey` FOREIGN KEY (`programaId`) REFERENCES `RestauranteFidelidadePrograma`(`id`) ON DELETE CASCADE ON UPDATE CASCADE'
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @statement = IF(
  EXISTS(SELECT 1 FROM information_schema.`TABLE_CONSTRAINTS` WHERE `CONSTRAINT_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'RestauranteFidelidadeLancamento' AND `CONSTRAINT_NAME` = 'RestauranteFidelidadeLancamento_programaId_fkey' AND `CONSTRAINT_TYPE` = 'FOREIGN KEY'),
  'SELECT 1',
  'ALTER TABLE `RestauranteFidelidadeLancamento` ADD CONSTRAINT `RestauranteFidelidadeLancamento_programaId_fkey` FOREIGN KEY (`programaId`) REFERENCES `RestauranteFidelidadePrograma`(`id`) ON DELETE CASCADE ON UPDATE CASCADE'
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;
