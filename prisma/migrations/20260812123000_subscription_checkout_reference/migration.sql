ALTER TABLE `AssinaturaCiclo`
  ADD COLUMN `gatewayReference` VARCHAR(191) NULL,
  ADD COLUMN `paymentLink` TEXT NULL;

CREATE INDEX `AssinaturaCiclo_gatewayReference_idx`
  ON `AssinaturaCiclo`(`gatewayReference`);
