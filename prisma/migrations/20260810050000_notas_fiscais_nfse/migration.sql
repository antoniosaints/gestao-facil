-- Configuração NFS-e isolada por conta, incluindo certificado A1 cifrado.
CREATE TABLE `NotaFiscalConfiguracao` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `razaoSocial` VARCHAR(191) NULL,
    `nomeFantasia` VARCHAR(191) NULL,
    `documento` VARCHAR(32) NULL,
    `inscricaoEstadual` VARCHAR(64) NULL,
    `inscricaoMunicipal` VARCHAR(64) NULL,
    `regimeTributario` INTEGER NOT NULL DEFAULT 0,
    `codigoMunicipioIbge` VARCHAR(10) NULL,
    `codigoMunicipioPrestador` VARCHAR(32) NULL,
    `municipioNome` VARCHAR(120) NULL,
    `uf` VARCHAR(2) NULL,
    `cep` VARCHAR(16) NULL,
    `logradouro` VARCHAR(191) NULL,
    `numero` VARCHAR(32) NULL,
    `bairro` VARCHAR(120) NULL,
    `complemento` VARCHAR(120) NULL,
    `email` VARCHAR(191) NULL,
    `telefone` VARCHAR(32) NULL,
    `ambiente` VARCHAR(20) NOT NULL DEFAULT 'HOMOLOGACAO',
    `provedorNfse` VARCHAR(40) NOT NULL DEFAULT 'NACIONAL',
    `serieRps` INTEGER NOT NULL DEFAULT 1,
    `proximoNumeroRps` INTEGER NOT NULL DEFAULT 1,
    `codigoServicoPadrao` VARCHAR(32) NULL,
    `aliquotaIssPadrao` DECIMAL(5, 2) NULL,
    `certificadoReferencia` TEXT NULL,
    `certificadoNome` VARCHAR(191) NULL,
    `certificadoSenhaCifrada` TEXT NULL,
    `certificadoAtualizadoEm` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `NotaFiscalConfiguracao_contaId_key`(`contaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `NotaFiscal`
  ADD COLUMN `pdfPath` VARCHAR(191) NULL,
  ADD COLUMN `numero` VARCHAR(191) NULL,
  ADD COLUMN `codigoVerificacao` VARCHAR(191) NULL,
  ADD COLUMN `rpsNumero` VARCHAR(191) NULL,
  ADD COLUMN `codigoServico` VARCHAR(191) NULL,
  ADD COLUMN `discriminacao` TEXT NULL,
  ADD COLUMN `ambiente` VARCHAR(191) NULL DEFAULT 'HOMOLOGACAO',
  ADD COLUMN `provedor` VARCHAR(191) NULL DEFAULT 'NACIONAL',
  ADD COLUMN `erroMensagem` TEXT NULL,
  ADD COLUMN `requisicaoJson` JSON NULL,
  ADD COLUMN `respostaJson` JSON NULL,
  ADD COLUMN `emitidaEm` DATETIME(3) NULL,
  ADD COLUMN `atualizadaEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

CREATE INDEX `NotaFiscal_contaId_tipo_status_criadoEm_idx` ON `NotaFiscal`(`contaId`, `tipo`, `status`, `criadoEm`);

ALTER TABLE `NotaFiscalConfiguracao`
  ADD CONSTRAINT `NotaFiscalConfiguracao_contaId_fkey`
  FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
