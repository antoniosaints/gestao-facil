ALTER TABLE `Produto`
    ADD COLUMN `mostrarNoPdv` BOOLEAN NULL DEFAULT true,
    ADD COLUMN `materiaPrima` BOOLEAN NULL DEFAULT false;
