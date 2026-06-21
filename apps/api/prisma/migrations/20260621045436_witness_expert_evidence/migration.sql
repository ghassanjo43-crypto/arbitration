-- CreateEnum
CREATE TYPE "WitnessStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'WITHDRAWN', 'TESTIFIED');

-- CreateEnum
CREATE TYPE "OathKind" AS ENUM ('NONE', 'OATH', 'AFFIRMATION');

-- CreateEnum
CREATE TYPE "ExpertAppointment" AS ENUM ('PARTY_APPOINTED', 'TRIBUNAL_APPOINTED');

-- CreateEnum
CREATE TYPE "ExpertStatus" AS ENUM ('PROPOSED', 'APPOINTED', 'REPORTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ExpertReportKind" AS ENUM ('REPORT', 'REPLY_REPORT', 'JOINT_STATEMENT');

-- CreateEnum
CREATE TYPE "EvidenceTargetType" AS ENUM ('DOCUMENT', 'WITNESS', 'WITNESS_STATEMENT', 'EXPERT', 'EXPERT_REPORT');

-- CreateEnum
CREATE TYPE "EvidenceObjectionStatus" AS ENUM ('RAISED', 'UPHELD', 'DISMISSED', 'DEFERRED');

-- CreateTable
CREATE TABLE "Witness" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "partyId" TEXT,
    "fullName" TEXT NOT NULL,
    "capacity" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "interpreterRequired" BOOLEAN NOT NULL DEFAULT false,
    "availabilityNote" TEXT,
    "identityVerified" BOOLEAN NOT NULL DEFAULT false,
    "isolationAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "crossExaminationRequired" BOOLEAN NOT NULL DEFAULT false,
    "hearingAttendance" TEXT,
    "oath" "OathKind" NOT NULL DEFAULT 'NONE',
    "oathRecordedAt" TIMESTAMP(3),
    "status" "WitnessStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Witness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WitnessStatement" (
    "id" TEXT NOT NULL,
    "witnessId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "documentId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WitnessStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expert" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "appointment" "ExpertAppointment" NOT NULL,
    "partyId" TEXT,
    "fullName" TEXT NOT NULL,
    "expertise" TEXT NOT NULL,
    "instructions" TEXT,
    "independenceDeclared" BOOLEAN NOT NULL DEFAULT false,
    "conflictDisclosed" BOOLEAN NOT NULL DEFAULT false,
    "feeArrangement" TEXT,
    "status" "ExpertStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpertReport" (
    "id" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "kind" "ExpertReportKind" NOT NULL DEFAULT 'REPORT',
    "title" TEXT NOT NULL,
    "documentId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpertReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceObjection" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "targetType" "EvidenceTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "ground" TEXT NOT NULL,
    "detail" TEXT,
    "raisedById" TEXT NOT NULL,
    "status" "EvidenceObjectionStatus" NOT NULL DEFAULT 'RAISED',
    "ruling" TEXT,
    "ruledById" TEXT,
    "ruledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceObjection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Witness_caseId_idx" ON "Witness"("caseId");

-- CreateIndex
CREATE INDEX "WitnessStatement_witnessId_idx" ON "WitnessStatement"("witnessId");

-- CreateIndex
CREATE INDEX "Expert_caseId_idx" ON "Expert"("caseId");

-- CreateIndex
CREATE INDEX "ExpertReport_expertId_idx" ON "ExpertReport"("expertId");

-- CreateIndex
CREATE INDEX "EvidenceObjection_caseId_idx" ON "EvidenceObjection"("caseId");

-- CreateIndex
CREATE INDEX "EvidenceObjection_targetType_targetId_idx" ON "EvidenceObjection"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "Witness" ADD CONSTRAINT "Witness_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WitnessStatement" ADD CONSTRAINT "WitnessStatement_witnessId_fkey" FOREIGN KEY ("witnessId") REFERENCES "Witness"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expert" ADD CONSTRAINT "Expert_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertReport" ADD CONSTRAINT "ExpertReport_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "Expert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceObjection" ADD CONSTRAINT "EvidenceObjection_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
