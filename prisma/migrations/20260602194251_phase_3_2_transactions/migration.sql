-- CreateTable
CREATE TABLE `Transaction` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `labelEnc` TEXT NOT NULL,
    `labelHash` VARCHAR(191) NOT NULL,
    `rawLabelEnc` TEXT NOT NULL,
    `rawLabelHash` VARCHAR(191) NOT NULL,
    `merchantKeyHash` VARCHAR(191) NULL,
    `noteEnc` TEXT NULL,
    `categoryId` VARCHAR(191) NULL,
    `manuallyCategorized` BOOLEAN NOT NULL DEFAULT false,
    `externalId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Transaction_accountId_date_createdAt_idx`(`accountId`, `date`, `createdAt`),
    INDEX `Transaction_categoryId_date_idx`(`categoryId`, `date`),
    INDEX `Transaction_accountId_categoryId_idx`(`accountId`, `categoryId`),
    INDEX `Transaction_labelHash_idx`(`labelHash`),
    INDEX `Transaction_rawLabelHash_idx`(`rawLabelHash`),
    INDEX `Transaction_merchant_directory_idx`(`accountId`, `merchantKeyHash`, `categoryId`, `type`, `amount`, `date`),
    INDEX `Transaction_date_idx`(`date`),
    UNIQUE INDEX `Transaction_accountId_externalId_key`(`accountId`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TransactionSearchToken` (
    `id` VARCHAR(191) NOT NULL,
    `transactionId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,

    INDEX `TransactionSearchToken_transactionId_idx`(`transactionId`),
    UNIQUE INDEX `TransactionSearchToken_tokenHash_transactionId_key`(`tokenHash`, `transactionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `BankAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransactionSearchToken` ADD CONSTRAINT `TransactionSearchToken_transactionId_fkey` FOREIGN KEY (`transactionId`) REFERENCES `Transaction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
