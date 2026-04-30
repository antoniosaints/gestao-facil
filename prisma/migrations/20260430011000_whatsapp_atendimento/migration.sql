-- CreateTable
CREATE TABLE `WhatsAppInstancia` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `instanceId` VARCHAR(191) NOT NULL,
    `token` TEXT NOT NULL,
    `webhookSecret` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDENTE', 'CONECTADA', 'DESCONECTADA', 'CONECTANDO', 'ERRO') NOT NULL DEFAULT 'PENDENTE',
    `numeroConectado` VARCHAR(191) NULL,
    `devicePayload` TEXT NULL,
    `ultimoErro` TEXT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `lastSyncAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WhatsAppInstancia_instanceId_key`(`instanceId`),
    UNIQUE INDEX `WhatsAppInstancia_webhookSecret_key`(`webhookSecret`),
    INDEX `WhatsAppInstancia_contaId_status_idx`(`contaId`, `status`),
    UNIQUE INDEX `WhatsAppInstancia_contaId_instanceId_key`(`contaId`, `instanceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsAppContato` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `telefone` VARCHAR(191) NOT NULL,
    `nome` VARCHAR(191) NULL,
    `foto` TEXT NULL,
    `clienteId` INTEGER NULL,
    `dadosAuxiliares` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WhatsAppContato_contaId_clienteId_idx`(`contaId`, `clienteId`),
    UNIQUE INDEX `WhatsAppContato_contaId_telefone_key`(`contaId`, `telefone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsAppConversa` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `instanciaId` INTEGER NOT NULL,
    `contatoId` INTEGER NOT NULL,
    `clienteId` INTEGER NULL,
    `telefone` VARCHAR(191) NOT NULL,
    `status` ENUM('ABERTA', 'PENDENTE', 'FINALIZADA') NOT NULL DEFAULT 'ABERTA',
    `atendenteId` INTEGER NULL,
    `setor` VARCHAR(191) NULL,
    `fila` VARCHAR(191) NULL,
    `canal` VARCHAR(191) NOT NULL DEFAULT 'whatsapp',
    `ultimaMensagem` TEXT NULL,
    `ultimaInteracaoEm` DATETIME(3) NULL,
    `naoLidas` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WhatsAppConversa_contaId_status_ultimaInteracaoEm_idx`(`contaId`, `status`, `ultimaInteracaoEm`),
    INDEX `WhatsAppConversa_contaId_atendenteId_idx`(`contaId`, `atendenteId`),
    INDEX `WhatsAppConversa_contaId_clienteId_idx`(`contaId`, `clienteId`),
    UNIQUE INDEX `WhatsAppConversa_contaId_instanciaId_telefone_key`(`contaId`, `instanciaId`, `telefone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsAppMensagem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `conversaId` INTEGER NOT NULL,
    `instanciaId` INTEGER NOT NULL,
    `direcao` ENUM('ENTRADA', 'SAIDA') NOT NULL,
    `tipo` ENUM('TEXTO', 'IMAGEM', 'AUDIO', 'VIDEO', 'DOCUMENTO', 'STICKER', 'LINK', 'LOCALIZACAO', 'CONTATO', 'OUTRO') NOT NULL DEFAULT 'TEXTO',
    `externalMessageId` VARCHAR(191) NOT NULL,
    `conteudo` TEXT NULL,
    `mediaUrl` TEXT NULL,
    `mediaMimeType` VARCHAR(191) NULL,
    `fileName` VARCHAR(191) NULL,
    `rawPayload` LONGTEXT NULL,
    `statusEnvio` ENUM('PENDENTE', 'ENVIADA', 'ENTREGUE', 'LIDA', 'ERRO', 'RECEBIDA') NOT NULL DEFAULT 'PENDENTE',
    `erroEnvio` TEXT NULL,
    `enviadoEm` DATETIME(3) NULL,
    `lidoEm` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WhatsAppMensagem_contaId_conversaId_createdAt_idx`(`contaId`, `conversaId`, `createdAt`),
    INDEX `WhatsAppMensagem_contaId_statusEnvio_idx`(`contaId`, `statusEnvio`),
    UNIQUE INDEX `WhatsAppMensagem_contaId_instanciaId_externalMessageId_key`(`contaId`, `instanciaId`, `externalMessageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsAppWebhookEvento` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `instanciaId` INTEGER NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `payload` LONGTEXT NOT NULL,
    `processado` BOOLEAN NOT NULL DEFAULT false,
    `erro` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,

    INDEX `WhatsAppWebhookEvento_contaId_tipo_createdAt_idx`(`contaId`, `tipo`, `createdAt`),
    UNIQUE INDEX `WhatsAppWebhookEvento_instanciaId_eventId_key`(`instanciaId`, `eventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WhatsAppInstancia` ADD CONSTRAINT `WhatsAppInstancia_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppContato` ADD CONSTRAINT `WhatsAppContato_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppContato` ADD CONSTRAINT `WhatsAppContato_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `ClientesFornecedores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppConversa` ADD CONSTRAINT `WhatsAppConversa_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppConversa` ADD CONSTRAINT `WhatsAppConversa_instanciaId_fkey` FOREIGN KEY (`instanciaId`) REFERENCES `WhatsAppInstancia`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppConversa` ADD CONSTRAINT `WhatsAppConversa_contatoId_fkey` FOREIGN KEY (`contatoId`) REFERENCES `WhatsAppContato`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppConversa` ADD CONSTRAINT `WhatsAppConversa_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `ClientesFornecedores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppConversa` ADD CONSTRAINT `WhatsAppConversa_atendenteId_fkey` FOREIGN KEY (`atendenteId`) REFERENCES `Usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppMensagem` ADD CONSTRAINT `WhatsAppMensagem_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppMensagem` ADD CONSTRAINT `WhatsAppMensagem_conversaId_fkey` FOREIGN KEY (`conversaId`) REFERENCES `WhatsAppConversa`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppMensagem` ADD CONSTRAINT `WhatsAppMensagem_instanciaId_fkey` FOREIGN KEY (`instanciaId`) REFERENCES `WhatsAppInstancia`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppWebhookEvento` ADD CONSTRAINT `WhatsAppWebhookEvento_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppWebhookEvento` ADD CONSTRAINT `WhatsAppWebhookEvento_instanciaId_fkey` FOREIGN KEY (`instanciaId`) REFERENCES `WhatsAppInstancia`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
