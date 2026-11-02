-- CreateTable
CREATE TABLE "VoucherSpend" (
    "id" TEXT NOT NULL,
    "mandateHash" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "cumulative" TEXT NOT NULL,
    "delta" TEXT NOT NULL,
    "autonomous" BOOLEAN NOT NULL,
    "recipient" TEXT NOT NULL,
    "messageHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherSpend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoucherSpend_messageHash_key" ON "VoucherSpend"("messageHash");

-- CreateIndex
CREATE INDEX "VoucherSpend_mandateHash_createdAt_idx" ON "VoucherSpend"("mandateHash", "createdAt");

-- CreateIndex
CREATE INDEX "VoucherSpend_mandateHash_channelId_idx" ON "VoucherSpend"("mandateHash", "channelId");
