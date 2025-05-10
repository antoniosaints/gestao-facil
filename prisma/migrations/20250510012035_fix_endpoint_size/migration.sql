-- DropIndex
DROP INDEX `Subscription_endpoint_idx` ON `Subscription`;

-- DropIndex
DROP INDEX `Subscription_endpoint_key` ON `Subscription`;

-- AlterTable
ALTER TABLE `Subscription` MODIFY `endpoint` TEXT NOT NULL;
