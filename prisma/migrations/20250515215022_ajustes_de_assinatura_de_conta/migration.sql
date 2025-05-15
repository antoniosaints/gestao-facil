/*
  Warnings:

  - Added the required column `asaasCustomerId` to the `Contas` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `Contas` ADD COLUMN `asaasCustomerId` VARCHAR(191) NOT NULL,
    ADD COLUMN `asaasSubscriptionId` VARCHAR(191) NULL;
