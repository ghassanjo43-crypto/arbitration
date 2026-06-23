-- CreateEnum
CREATE TYPE "ScreeningSubjectType" AS ENUM ('PARTY', 'COMPANY', 'LAWYER', 'ARBITRATOR', 'INDIVIDUAL', 'BENEFICIAL_OWNER');

-- CreateEnum
CREATE TYPE "ScreeningType" AS ENUM ('SANCTIONS', 'PEP', 'ADVERSE_MEDIA', 'AML', 'IDENTITY');

-- CreateEnum
CREATE TYPE "ScreeningStatus" AS ENUM ('NOT_SCREENED', 'PENDING', 'CLEAR', 'POSSIBLE_MATCH', 'FAILED', 'EXPIRED', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "ScreeningDecision" AS ENUM ('APPROVED', 'REJECTED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "ComplianceHoldStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- CreateTable
CREATE TABLE "ScreeningCheck" (
    "id" TEXT NOT NULL,
    "subjectType" "ScreeningSubjectType" NOT NULL,
    "subjectId" TEXT,
    "subjectName" TEXT NOT NULL,
    "caseId" TEXT,
    "screeningType" "ScreeningType" NOT NULL,
    "status" "ScreeningStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "providerRef" TEXT,
    "riskScore" INTEGER,
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "resultSummary" TEXT,
    "triggerEvent" TEXT,
    "requestedById" TEXT,
    "screenedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewDecision" "ScreeningDecision",
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreeningCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceHold" (
    "id" TEXT NOT NULL,
    "caseId" TEXT,
    "subjectType" "ScreeningSubjectType" NOT NULL,
    "subjectId" TEXT,
    "reason" TEXT NOT NULL,
    "status" "ComplianceHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "screeningCheckId" TEXT,
    "createdById" TEXT,
    "releasedById" TEXT,
    "releaseNote" TEXT,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScreeningCheck_subjectType_subjectId_idx" ON "ScreeningCheck"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "ScreeningCheck_caseId_idx" ON "ScreeningCheck"("caseId");

-- CreateIndex
CREATE INDEX "ScreeningCheck_status_idx" ON "ScreeningCheck"("status");

-- CreateIndex
CREATE INDEX "ComplianceHold_caseId_idx" ON "ComplianceHold"("caseId");

-- CreateIndex
CREATE INDEX "ComplianceHold_status_idx" ON "ComplianceHold"("status");

-- AddForeignKey
ALTER TABLE "ComplianceHold" ADD CONSTRAINT "ComplianceHold_screeningCheckId_fkey" FOREIGN KEY ("screeningCheckId") REFERENCES "ScreeningCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;
