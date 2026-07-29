ALTER TABLE `ComboSaida`
    ADD COLUMN `comandaItemId` INTEGER NULL,
    ADD COLUMN `comandaOperacaoItemId` INTEGER NULL;

CREATE UNIQUE INDEX `ComboSaida_comandaItemId_key`
    ON `ComboSaida`(`comandaItemId`);

CREATE INDEX `ComboSaida_comandaItemId_idx`
    ON `ComboSaida`(`comandaItemId`);

CREATE UNIQUE INDEX `ComboSaida_comandaOperacaoItemId_key`
    ON `ComboSaida`(`comandaOperacaoItemId`);

CREATE INDEX `ComboSaida_comandaOperacaoItemId_idx`
    ON `ComboSaida`(`comandaOperacaoItemId`);

ALTER TABLE `ComboSaida`
    ADD CONSTRAINT `ComboSaida_comandaItemId_fkey`
    FOREIGN KEY (`comandaItemId`) REFERENCES `ComandaItem`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ComboSaida`
    ADD CONSTRAINT `ComboSaida_comandaOperacaoItemId_fkey`
    FOREIGN KEY (`comandaOperacaoItemId`) REFERENCES `ComandaOperacaoItem`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
