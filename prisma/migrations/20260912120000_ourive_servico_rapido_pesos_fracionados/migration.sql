-- Pesos de metais são controlados em gramas com precisão de miligramas.
-- Produtos comuns continuam aceitando valores inteiros normalmente.
ALTER TABLE `Produto`
  MODIFY `estoque` DECIMAL(12, 3) NOT NULL,
  MODIFY `minimo` DECIMAL(12, 3) NOT NULL;

ALTER TABLE `MovimentacoesEstoque`
  MODIFY `quantidade` DECIMAL(12, 3) NOT NULL;

-- Um serviço rápido pode ter responsável sem precisar criar uma etapa de produção artificial.
CREATE TABLE `OuriveOrdemResponsavel` (
  `ordemOuriveId` INTEGER NOT NULL,
  `usuarioId` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`ordemOuriveId`, `usuarioId`),
  INDEX `OuriveOrdemResponsavel_usuarioId_idx` (`usuarioId`),
  CONSTRAINT `OuriveOrdemResponsavel_ordemOuriveId_fkey`
    FOREIGN KEY (`ordemOuriveId`) REFERENCES `OuriveOrdem`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
