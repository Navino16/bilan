-- CreateTable
CREATE TABLE `GroupInvitation` (
    `id` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `invitedById` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'MEMBER',
    `tokenEnc` TEXT NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `codeEnc` TEXT NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `acceptedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `GroupInvitation_tokenHash_key`(`tokenHash`),
    UNIQUE INDEX `GroupInvitation_codeHash_key`(`codeHash`),
    INDEX `GroupInvitation_email_idx`(`email`),
    INDEX `GroupInvitation_groupId_idx`(`groupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `GroupInvitation` ADD CONSTRAINT `GroupInvitation_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `Group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GroupInvitation` ADD CONSTRAINT `GroupInvitation_invitedById_fkey` FOREIGN KEY (`invitedById`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
