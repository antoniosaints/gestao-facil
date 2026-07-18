-- Contagem informada por método no fechamento do caixa (PDV PRO).
-- Alteração aditiva e nullable: não afeta dados existentes.
ALTER TABLE `CaixaSessao` ADD COLUMN `fechamentoMetodos` JSON NULL;
