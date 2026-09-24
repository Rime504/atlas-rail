-- CreateEnum
CREATE TYPE "MandateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "AgentDecisionOutcome" AS ENUM ('ALLOW', 'DENY', 'ESCALATE');

-- CreateEnum
CREATE TYPE "AgentApprovalState" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "AgentSpendStatus" AS ENUM ('RESERVED', 'SETTLED', 'RELEASED');

-- CreateEnum
CREATE TYPE "AnchorBatchStatus" AS ENUM ('ANCHORED', 'FAILED');

-- CreateTable
CREATE TABLE "AgentMandate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mandateHash" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "status" "MandateStatus" NOT NULL DEFAULT 'DRAFT',
    "agentPublicKey" TEXT NOT NULL,
    "agentLabel" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "notBefore" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "signers" JSONB NOT NULL DEFAULT '[]',
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "revokedByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDecision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "mandateHash" TEXT NOT NULL,
    "offerHash" TEXT NOT NULL,
    "decision" "AgentDecisionOutcome" NOT NULL,
    "kind" TEXT,
    "failedRule" TEXT,
    "reason" TEXT NOT NULL,
    "record" JSONB NOT NULL,
    "decisionHash" TEXT NOT NULL,
    "requestNonce" TEXT,
    "requestHash" TEXT,
    "authorization" JSONB,
    "approvalId" TEXT,
    "amountBaseUnits" TEXT NOT NULL,
    "payTo" TEXT NOT NULL,
    "resourceUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentApproval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "offerHash" TEXT NOT NULL,
    "offer" JSONB NOT NULL,
    "status" "AgentApprovalState" NOT NULL DEFAULT 'PENDING',
    "requiredRoles" JSONB NOT NULL,
    "escalationRules" JSONB NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decidedByRole" TEXT,
    "comment" TEXT,

    CONSTRAINT "AgentApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSpend" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "amountBaseUnits" TEXT NOT NULL,
    "autonomous" BOOLEAN NOT NULL,
    "status" "AgentSpendStatus" NOT NULL DEFAULT 'RESERVED',
    "txSignature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentSpend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoundReceipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "receiptHash" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "txSignature" TEXT NOT NULL,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoundReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnchorBatch" (
    "id" TEXT NOT NULL,
    "merkleRoot" TEXT NOT NULL,
    "leafCount" INTEGER NOT NULL,
    "txSignature" TEXT,
    "status" "AnchorBatchStatus" NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anchoredAt" TIMESTAMP(3),

    CONSTRAINT "AnchorBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSigningKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSigningKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentMandate_organizationId_status_idx" ON "AgentMandate"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AgentMandate_agentPublicKey_idx" ON "AgentMandate"("agentPublicKey");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMandate_organizationId_nonce_key" ON "AgentMandate"("organizationId", "nonce");

-- CreateIndex
CREATE INDEX "AgentDecision_organizationId_createdAt_idx" ON "AgentDecision"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentDecision_mandateId_createdAt_idx" ON "AgentDecision"("mandateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentDecision_mandateId_requestNonce_key" ON "AgentDecision"("mandateId", "requestNonce");

-- CreateIndex
CREATE INDEX "AgentApproval_organizationId_status_idx" ON "AgentApproval"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AgentApproval_mandateId_idx" ON "AgentApproval"("mandateId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentSpend_decisionId_key" ON "AgentSpend"("decisionId");

-- CreateIndex
CREATE INDEX "AgentSpend_mandateId_createdAt_idx" ON "AgentSpend"("mandateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BoundReceipt_decisionId_key" ON "BoundReceipt"("decisionId");

-- CreateIndex
CREATE UNIQUE INDEX "BoundReceipt_receiptHash_key" ON "BoundReceipt"("receiptHash");

-- CreateIndex
CREATE INDEX "BoundReceipt_organizationId_createdAt_idx" ON "BoundReceipt"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "BoundReceipt_batchId_idx" ON "BoundReceipt"("batchId");

-- CreateIndex
CREATE INDEX "AnchorBatch_createdAt_idx" ON "AnchorBatch"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserSigningKey_userId_key" ON "UserSigningKey"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSigningKey_publicKey_key" ON "UserSigningKey"("publicKey");

-- AddForeignKey
ALTER TABLE "AgentMandate" ADD CONSTRAINT "AgentMandate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSpend" ADD CONSTRAINT "AgentSpend_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoundReceipt" ADD CONSTRAINT "BoundReceipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Append-only enforcement (ADR 0002 / 0005). Decisions, bound receipts and anchor batches are evidence: the database itself refuses to rewrite or delete them, so a compromised
-- application credential cannot quietly change history.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION atlas_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Atlas Rail: % on % is not permitted (append-only evidence table)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AgentDecision_append_only"
  BEFORE UPDATE OR DELETE ON "AgentDecision"
  FOR EACH ROW EXECUTE FUNCTION atlas_reject_mutation();

-- Receipts may only gain their Merkle anchor: the batch id and the "anchor" member of the document.
-- Every other byte of a receipt is frozen, and receipts can never be deleted.
CREATE OR REPLACE FUNCTION atlas_receipt_anchor_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Atlas Rail: DELETE on BoundReceipt is not permitted (append-only evidence table)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW."id", NEW."organizationId", NEW."mandateId", NEW."decisionId", NEW."receiptHash", NEW."txSignature", NEW."createdAt")
       IS DISTINCT FROM
     (OLD."id", OLD."organizationId", OLD."mandateId", OLD."decisionId", OLD."receiptHash", OLD."txSignature", OLD."createdAt")
     OR (NEW."document" - 'anchor') IS DISTINCT FROM (OLD."document" - 'anchor') THEN
    RAISE EXCEPTION 'Atlas Rail: only the anchor of a BoundReceipt may be added'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BoundReceipt_anchor_only"
  BEFORE UPDATE OR DELETE ON "BoundReceipt"
  FOR EACH ROW EXECUTE FUNCTION atlas_receipt_anchor_only();

-- Anchor batches are history too: a batch may not be edited or removed once written.
CREATE TRIGGER "AnchorBatch_append_only"
  BEFORE UPDATE OR DELETE ON "AnchorBatch"
  FOR EACH ROW EXECUTE FUNCTION atlas_reject_mutation();
