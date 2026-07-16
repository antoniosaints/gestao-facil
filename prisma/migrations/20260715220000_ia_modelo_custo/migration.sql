-- AlterTable: custo por milhão de tokens (entrada/saída) por modelo de IA
ALTER TABLE `IaModelo`
    ADD COLUMN `custoInputMilhao` DECIMAL(12, 6) NULL,
    ADD COLUMN `custoOutputMilhao` DECIMAL(12, 6) NULL;
