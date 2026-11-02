-- CreateTable
CREATE TABLE "OwnerApproval" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mandateHash" TEXT NOT NULL,
    "subjectHash" TEXT NOT NULL,
    "offerHash" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "telegramMessageId" INTEGER,

    CONSTRAINT "OwnerApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OwnerApproval_subjectHash_createdAt_idx" ON "OwnerApproval"("subjectHash", "createdAt");
