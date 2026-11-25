ALTER TABLE `Emprestimo`
    ADD COLUMN `antecipacaoParcelaBps` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `antecipacaoParcelaCentavos` INTEGER NOT NULL DEFAULT 0;
