-- P0 indexes for core list / auth / housekeeping paths.

-- CreateIndex
CREATE INDEX "Payout_organizationId_createdAt_idx" ON "Payout"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Payout_status_updatedAt_idx" ON "Payout"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_organizationId_createdAt_idx" ON "LedgerEntry"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiKey_keyPrefix_keyHash_idx" ON "ApiKey"("keyPrefix", "keyHash");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");
