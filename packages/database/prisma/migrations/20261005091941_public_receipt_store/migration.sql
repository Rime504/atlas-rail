-- CreateTable
CREATE TABLE "PublicReceipt" (
    "id" TEXT NOT NULL,
    "receiptHash" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicReceipt_receiptHash_key" ON "PublicReceipt"("receiptHash");

-- CreateIndex
CREATE INDEX "PublicReceipt_createdAt_idx" ON "PublicReceipt"("createdAt");
