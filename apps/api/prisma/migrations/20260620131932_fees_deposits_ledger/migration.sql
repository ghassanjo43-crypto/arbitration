-- CreateEnum
CREATE TYPE "FeeScheduleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "FeeBasis" AS ENUM ('FLAT', 'PER_ARBITRATOR', 'PERCENTAGE', 'AD_VALOREM');

-- CreateEnum
CREATE TYPE "AllocationMethod" AS ENUM ('EQUAL', 'BY_PARTY_COUNT', 'BY_CLAIM_VALUE', 'BY_CLAIM_AND_COUNTERCLAIM', 'BY_TRIBUNAL', 'BY_AGREEMENT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('REQUESTED', 'PARTIALLY_PAID', 'PAID', 'IN_DEFAULT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShareStatus" AS ENUM ('OUTSTANDING', 'PARTIALLY_PAID', 'PAID', 'PAID_BY_SUBSTITUTE', 'IN_DEFAULT', 'WAIVED');

-- CreateEnum
CREATE TYPE "LedgerEntryKind" AS ENUM ('CHARGE', 'PAYMENT', 'REFUND', 'ADJUSTMENT', 'SUBSTITUTE_PAYMENT');

-- CreateTable
CREATE TABLE "FeeSchedule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleAr" TEXT,
    "description" TEXT,
    "descriptionAr" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeScheduleVersion" (
    "id" TEXT NOT NULL,
    "feeScheduleId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "FeeScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effectiveDate" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeScheduleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeScheduleItem" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelAr" TEXT,
    "basis" "FeeBasis" NOT NULL DEFAULT 'FLAT',
    "amount" DECIMAL(18,2),
    "percentage" DECIMAL(6,4),
    "minAmount" DECIMAL(18,2),
    "maxAmount" DECIMAL(18,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FeeScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositRequest" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "allocationMethod" "AllocationMethod" NOT NULL DEFAULT 'EQUAL',
    "status" "DepositStatus" NOT NULL DEFAULT 'REQUESTED',
    "dueAt" TIMESTAMP(3),
    "isSupplementary" BOOLEAN NOT NULL DEFAULT false,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositAllocation" (
    "id" TEXT NOT NULL,
    "depositRequestId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "side" "PartySide",
    "shareAmount" DECIMAL(18,2) NOT NULL,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "ShareStatus" NOT NULL DEFAULT 'OUTSTANDING',
    "paidBySubstitutePartyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositPayment" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paidByUserId" TEXT,
    "paidByPartyId" TEXT,
    "substitute" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "providerRef" TEXT,
    "receiptNumber" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepositPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "authorisedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentDefault" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "amountOutstanding" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "declaredById" TEXT NOT NULL,
    "referredAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentDefault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialLedgerEntry" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" "LedgerEntryKind" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "partyId" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeeSchedule_code_key" ON "FeeSchedule"("code");

-- CreateIndex
CREATE UNIQUE INDEX "FeeScheduleVersion_feeScheduleId_version_key" ON "FeeScheduleVersion"("feeScheduleId", "version");

-- CreateIndex
CREATE INDEX "DepositRequest_caseId_idx" ON "DepositRequest"("caseId");

-- CreateIndex
CREATE INDEX "DepositAllocation_depositRequestId_idx" ON "DepositAllocation"("depositRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "DepositPayment_receiptNumber_key" ON "DepositPayment"("receiptNumber");

-- CreateIndex
CREATE INDEX "DepositPayment_allocationId_idx" ON "DepositPayment"("allocationId");

-- CreateIndex
CREATE INDEX "PaymentDefault_allocationId_idx" ON "PaymentDefault"("allocationId");

-- CreateIndex
CREATE INDEX "FinancialLedgerEntry_caseId_idx" ON "FinancialLedgerEntry"("caseId");

-- AddForeignKey
ALTER TABLE "FeeScheduleVersion" ADD CONSTRAINT "FeeScheduleVersion_feeScheduleId_fkey" FOREIGN KEY ("feeScheduleId") REFERENCES "FeeSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeScheduleItem" ADD CONSTRAINT "FeeScheduleItem_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "FeeScheduleVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositRequest" ADD CONSTRAINT "DepositRequest_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositAllocation" ADD CONSTRAINT "DepositAllocation_depositRequestId_fkey" FOREIGN KEY ("depositRequestId") REFERENCES "DepositRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositPayment" ADD CONSTRAINT "DepositPayment_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "DepositAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "DepositPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentDefault" ADD CONSTRAINT "PaymentDefault_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "DepositAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialLedgerEntry" ADD CONSTRAINT "FinancialLedgerEntry_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
