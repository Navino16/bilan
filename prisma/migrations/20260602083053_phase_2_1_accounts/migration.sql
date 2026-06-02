-- CreateTable
CREATE TABLE `BankAccount` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `initialBalance` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `ibanEnc` TEXT NULL,
    `ibanHash` VARCHAR(191) NULL,
    `bankName` VARCHAR(191) NULL,
    `color` VARCHAR(191) NULL DEFAULT '#2563eb',
    `icon` VARCHAR(191) NULL,
    `archived` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BankAccount_ownerId_idx`(`ownerId`),
    INDEX `BankAccount_ibanHash_idx`(`ibanHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BankAccount` ADD CONSTRAINT `BankAccount_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
