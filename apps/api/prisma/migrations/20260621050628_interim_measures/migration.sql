-- CreateEnum
CREATE TYPE "InterimMeasureType" AS ENUM ('ASSET_PRESERVATION', 'EVIDENCE_PRESERVATION', 'CONFIDENTIALITY', 'SECURITY_FOR_COSTS', 'STATUS_QUO', 'INSPECTION', 'DOCUMENT_PRESERVATION', 'URGENT_PROTECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "InterimUrgency" AS ENUM ('STANDARD', 'URGENT', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "InterimStatus" AS ENUM ('APPLIED', 'OPPOSED', 'UNDER_CONSIDERATION', 'GRANTED', 'GRANTED_IN_PART', 'DENIED', 'MODIFIED', 'DISCHARGED');

-- CreateEnum
CREATE TYPE "InterimEventKind" AS ENUM ('NOTICE', 'OPPOSITION', 'DECISION', 'MODIFICATION', 'DISCHARGE', 'COMPLIANCE');

-- CreateTable
CREATE TABLE "InterimMeasure" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "measureNumber" TEXT NOT NULL,
    "type" "InterimMeasureType" NOT NULL,
    "urgency" "InterimUrgency" NOT NULL DEFAULT 'STANDARD',
    "applicantPartyId" TEXT,
    "appliedById" TEXT NOT NULL,
    "reliefSought" TEXT NOT NULL,
    "grounds" TEXT,
    "status" "InterimStatus" NOT NULL DEFAULT 'APPLIED',
    "decision" TEXT,
    "decisionReason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterimMeasure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterimMeasureEvent" (
    "id" TEXT NOT NULL,
    "measureId" TEXT NOT NULL,
    "kind" "InterimEventKind" NOT NULL,
    "detail" TEXT NOT NULL,
    "actorById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterimMeasureEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterimMeasure_caseId_idx" ON "InterimMeasure"("caseId");

-- CreateIndex
CREATE INDEX "InterimMeasure_status_idx" ON "InterimMeasure"("status");

-- CreateIndex
CREATE UNIQUE INDEX "InterimMeasure_caseId_measureNumber_key" ON "InterimMeasure"("caseId", "measureNumber");

-- CreateIndex
CREATE INDEX "InterimMeasureEvent_measureId_idx" ON "InterimMeasureEvent"("measureId");

-- AddForeignKey
ALTER TABLE "InterimMeasure" ADD CONSTRAINT "InterimMeasure_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterimMeasureEvent" ADD CONSTRAINT "InterimMeasureEvent_measureId_fkey" FOREIGN KEY ("measureId") REFERENCES "InterimMeasure"("id") ON DELETE CASCADE ON UPDATE CASCADE;
