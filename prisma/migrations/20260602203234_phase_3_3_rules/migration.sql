-- CreateTable
CREATE TABLE `CategorizationRule` (
    `id` VARCHAR(191) NOT NULL,
    `pattern` VARCHAR(191) NOT NULL,
    `matchType` VARCHAR(191) NOT NULL,
    `caseSensitive` BOOLEAN NOT NULL DEFAULT false,
    `priority` INTEGER NOT NULL DEFAULT 100,
    `categoryId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `groupId` VARCHAR(191) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CategorizationRule_userId_idx`(`userId`),
    INDEX `CategorizationRule_groupId_idx`(`groupId`),
    INDEX `CategorizationRule_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CategorizationRule` ADD CONSTRAINT `CategorizationRule_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CategorizationRule` ADD CONSTRAINT `CategorizationRule_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CategorizationRule` ADD CONSTRAINT `CategorizationRule_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `Group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- NOTE: a scope-XOR CHECK ((userId IS NOT NULL) <> (groupId IS NOT NULL)) is
-- impossible on MariaDB here -- it rejects with error 1901 because both columns
-- participate in a foreign key with a referential action (ON DELETE CASCADE).
-- The XOR invariant is enforced in the service layer instead
-- (src/server/services/categorization), which always writes exactly one scope.
