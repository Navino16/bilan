-- CreateTable
CREATE TABLE `TransactionLink` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TransactionLink_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TransactionLinkMember` (
    `linkId` VARCHAR(191) NOT NULL,
    `transactionId` VARCHAR(191) NOT NULL,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TransactionLinkMember_transactionId_key`(`transactionId`),
    INDEX `TransactionLinkMember_linkId_idx`(`linkId`),
    PRIMARY KEY (`linkId`, `transactionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IgnoredLinkSuggestion` (
    `userId` VARCHAR(191) NOT NULL,
    `pairKey` VARCHAR(191) NOT NULL,
    `ignoredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IgnoredLinkSuggestion_userId_idx`(`userId`),
    PRIMARY KEY (`userId`, `pairKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TransactionLinkMember` ADD CONSTRAINT `TransactionLinkMember_linkId_fkey` FOREIGN KEY (`linkId`) REFERENCES `TransactionLink`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransactionLinkMember` ADD CONSTRAINT `TransactionLinkMember_transactionId_fkey` FOREIGN KEY (`transactionId`) REFERENCES `Transaction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
