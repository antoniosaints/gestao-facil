-- CreateTable
CREATE TABLE `IaCoreConfig` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provider` VARCHAR(191) NOT NULL DEFAULT 'gemini',
    `modelId` VARCHAR(191) NOT NULL DEFAULT 'gemini-2.0-flash-lite',
    `apiKey` TEXT NULL,
    `systemPrompt` LONGTEXT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
