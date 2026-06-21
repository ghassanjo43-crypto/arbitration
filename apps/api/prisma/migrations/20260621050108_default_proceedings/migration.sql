-- CreateEnum
CREATE TYPE "DefaultStage" AS ENUM ('OPENED', 'WARNING_ISSUED', 'FINAL_REMINDER_ISSUED', 'REGISTRAR_REVIEW', 'TRIBUNAL_REVIEW', 'PROCEED_AUTHORISED', 'PROCEED_REFUSED', 'CURED');

-- CreateEnum
CREATE TYPE "DefaultNoticeKind" AS ENUM ('WARNING', 'FINAL_REMINDER');

-- CreateEnum
CREATE TYPE "DefaultReviewFactor" AS ENUM ('ARBITRATION_AGREEMENT', 'JURISDICTION', 'VALID_SERVICE', 'DELIVERY_RECORDS', 'OPPORTUNITY_TO_RESPOND', 'EVIDENCE', 'EXPLANATION_FOR_ABSENCE', 'APPLICABLE_LAW', 'FAIRNESS');

-- CreateEnum
CREATE TYPE "DefaultOutcome" AS ENUM ('PROCEED', 'REFUSE', 'CURED');

-- CreateTable
CREATE TABLE "DefaultProceeding" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "defaultingPartyId" TEXT,
    "defaultingParticipant" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "stage" "DefaultStage" NOT NULL DEFAULT 'OPENED',
    "openedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefaultProceeding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefaultNotice" (
    "id" TEXT NOT NULL,
    "proceedingId" TEXT NOT NULL,
    "kind" "DefaultNoticeKind" NOT NULL,
    "body" TEXT NOT NULL,
    "deadlineAt" TIMESTAMP(3),
    "issuedById" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DefaultNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefaultReviewItem" (
    "id" TEXT NOT NULL,
    "proceedingId" TEXT NOT NULL,
    "factor" "DefaultReviewFactor" NOT NULL,
    "satisfied" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "DefaultReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefaultRegistrarReport" (
    "id" TEXT NOT NULL,
    "proceedingId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "serviceVerified" BOOLEAN NOT NULL DEFAULT false,
    "preparedById" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DefaultRegistrarReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefaultDecision" (
    "id" TEXT NOT NULL,
    "proceedingId" TEXT NOT NULL,
    "outcome" "DefaultOutcome" NOT NULL,
    "reason" TEXT NOT NULL,
    "defaultHearingScheduled" BOOLEAN NOT NULL DEFAULT false,
    "proceduralOrderRef" TEXT,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DefaultDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DefaultProceeding_caseId_idx" ON "DefaultProceeding"("caseId");

-- CreateIndex
CREATE INDEX "DefaultNotice_proceedingId_idx" ON "DefaultNotice"("proceedingId");

-- CreateIndex
CREATE UNIQUE INDEX "DefaultReviewItem_proceedingId_factor_key" ON "DefaultReviewItem"("proceedingId", "factor");

-- CreateIndex
CREATE UNIQUE INDEX "DefaultRegistrarReport_proceedingId_key" ON "DefaultRegistrarReport"("proceedingId");

-- CreateIndex
CREATE UNIQUE INDEX "DefaultDecision_proceedingId_key" ON "DefaultDecision"("proceedingId");

-- AddForeignKey
ALTER TABLE "DefaultProceeding" ADD CONSTRAINT "DefaultProceeding_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefaultNotice" ADD CONSTRAINT "DefaultNotice_proceedingId_fkey" FOREIGN KEY ("proceedingId") REFERENCES "DefaultProceeding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefaultReviewItem" ADD CONSTRAINT "DefaultReviewItem_proceedingId_fkey" FOREIGN KEY ("proceedingId") REFERENCES "DefaultProceeding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefaultRegistrarReport" ADD CONSTRAINT "DefaultRegistrarReport_proceedingId_fkey" FOREIGN KEY ("proceedingId") REFERENCES "DefaultProceeding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefaultDecision" ADD CONSTRAINT "DefaultDecision_proceedingId_fkey" FOREIGN KEY ("proceedingId") REFERENCES "DefaultProceeding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
