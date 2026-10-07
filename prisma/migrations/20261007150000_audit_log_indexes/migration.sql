-- CreateIndex
CREATE INDEX `AuditLog_createdAt_idx` ON `AuditLog`(`createdAt`);

-- CreateIndex
CREATE INDEX `AuditLog_entity_createdAt_idx` ON `AuditLog`(`entity`, `createdAt`);
