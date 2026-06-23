-- CreateEnum
CREATE TYPE "RetentionStatus" AS ENUM ('ACTIVE', 'RETAINED', 'ELIGIBLE_FOR_REVIEW', 'SCHEDULED_FOR_DELETION', 'DELETED', 'LEGAL_HOLD');

-- CreateEnum
CREATE TYPE "LegalHoldStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "legalHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retentionStatus" "RetentionStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "LegalHold" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "LegalHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "placedById" TEXT,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedById" TEXT,
    "releaseNote" TEXT,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "LegalHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionSweepRecord" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "category" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "caseId" TEXT,
    "action" TEXT NOT NULL,
    "eligibleAt" TIMESTAMP(3),
    "reason" TEXT,
    "hashPreserved" TEXT,
    "performedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetentionSweepRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegalHold_caseId_idx" ON "LegalHold"("caseId");

-- CreateIndex
CREATE INDEX "LegalHold_status_idx" ON "LegalHold"("status");

-- CreateIndex
CREATE INDEX "RetentionSweepRecord_runId_idx" ON "RetentionSweepRecord"("runId");

-- CreateIndex
CREATE INDEX "RetentionSweepRecord_caseId_idx" ON "RetentionSweepRecord"("caseId");

-- CreateIndex
CREATE INDEX "RetentionSweepRecord_category_idx" ON "RetentionSweepRecord"("category");
