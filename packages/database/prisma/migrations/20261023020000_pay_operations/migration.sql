-- CreateTable
CREATE TABLE "PayOperation" (
    "key" TEXT NOT NULL,
    "callerId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "bindingHash" TEXT NOT NULL,
    "mandateHash" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "approvalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayOperation_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "PayOperation_mandateHash_createdAt_idx" ON "PayOperation"("mandateHash", "createdAt");
