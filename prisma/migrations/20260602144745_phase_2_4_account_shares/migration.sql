-- CreateTable
CREATE TABLE `AccountShare` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `permission` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AccountShare_groupId_idx`(`groupId`),
    UNIQUE INDEX `AccountShare_accountId_groupId_key`(`accountId`, `groupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AccountShare` ADD CONSTRAINT `AccountShare_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `BankAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccountShare` ADD CONSTRAINT `AccountShare_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `Group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
