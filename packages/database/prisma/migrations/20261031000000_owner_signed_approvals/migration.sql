-- Owner approvals are signed by the owner's or an approver's wallet. A Telegram tap no longer approves.
ALTER TABLE "OwnerApproval" ADD COLUMN "signers" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "OwnerApproval" ADD COLUMN "signatureScheme" TEXT;
ALTER TABLE "OwnerApproval" ADD COLUMN "signer" TEXT;
ALTER TABLE "OwnerApproval" ADD COLUMN "signature" TEXT;
