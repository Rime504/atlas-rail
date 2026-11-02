-- CreateTable
CREATE TABLE "PayDecisionReceipt" (
    "id" TEXT NOT NULL,
    "mandateHash" TEXT NOT NULL,
    "receiptHash" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayDecisionReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayDecisionReceipt_receiptHash_key" ON "PayDecisionReceipt"("receiptHash");

-- CreateIndex
CREATE INDEX "PayDecisionReceipt_batchId_createdAt_idx" ON "PayDecisionReceipt"("batchId", "createdAt");
