-- CreateEnum
CREATE TYPE "FilingType" AS ENUM ('STATEMENT_OF_CLAIM', 'STATEMENT_OF_DEFENCE', 'COUNTERCLAIM', 'DEFENCE_TO_COUNTERCLAIM', 'REPLY', 'REJOINDER', 'AMENDMENT', 'JURISDICTIONAL_SUBMISSION', 'PROCEDURAL_APPLICATION', 'POST_HEARING_SUBMISSION');

-- CreateEnum
CREATE TYPE "FilingStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RECEIVED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED', 'CORRECTED');

-- CreateEnum
CREATE TYPE "FilingFeeStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "CorrectionApproval" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProductionStatus" AS ENUM ('REQUESTED', 'OBJECTED', 'REPLIED', 'GRANTED', 'GRANTED_IN_PART', 'DENIED', 'PRODUCED', 'NON_COMPLIANCE');

-- CreateTable
CREATE TABLE "Filing" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "filingNumber" TEXT NOT NULL,
    "type" "FilingType" NOT NULL,
    "title" TEXT NOT NULL,
    "partyId" TEXT,
    "representativeUserId" TEXT,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "officialTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "version" INTEGER NOT NULL DEFAULT 1,
    "contentHash" TEXT,
    "confidentiality" "ConfidentialityLevel" NOT NULL DEFAULT 'CASE_PARTIES',
    "feeStatus" "FilingFeeStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "status" "FilingStatus" NOT NULL DEFAULT 'SUBMITTED',
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Filing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilingDocument" (
    "id" TEXT NOT NULL,
    "filingId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FilingDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilingReceipt" (
    "id" TEXT NOT NULL,
    "filingId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FilingReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilingCorrection" (
    "id" TEXT NOT NULL,
    "filingId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approval" "CorrectionApproval" NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "previousVersion" INTEGER NOT NULL,
    "newVersion" INTEGER NOT NULL,
    "newFilingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FilingCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionRequest" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "requestingPartyId" TEXT,
    "requestedById" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "relevance" TEXT,
    "materiality" TEXT,
    "objection" TEXT,
    "objectedById" TEXT,
    "reply" TEXT,
    "tribunalDecision" TEXT,
    "decisionReason" TEXT,
    "decidedById" TEXT,
    "privilegeClaim" TEXT,
    "confidentialityOrder" TEXT,
    "status" "ProductionStatus" NOT NULL DEFAULT 'REQUESTED',
    "dueAt" TIMESTAMP(3),
    "producedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionDocument" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Filing_supersedesId_key" ON "Filing"("supersedesId");

-- CreateIndex
CREATE INDEX "Filing_caseId_idx" ON "Filing"("caseId");

-- CreateIndex
CREATE INDEX "Filing_status_idx" ON "Filing"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Filing_caseId_filingNumber_key" ON "Filing"("caseId", "filingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FilingDocument_filingId_documentId_key" ON "FilingDocument"("filingId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "FilingReceipt_filingId_key" ON "FilingReceipt"("filingId");

-- CreateIndex
CREATE UNIQUE INDEX "FilingReceipt_receiptNumber_key" ON "FilingReceipt"("receiptNumber");

-- CreateIndex
CREATE INDEX "FilingCorrection_filingId_idx" ON "FilingCorrection"("filingId");

-- CreateIndex
CREATE INDEX "ProductionRequest_caseId_idx" ON "ProductionRequest"("caseId");

-- CreateIndex
CREATE INDEX "ProductionRequest_status_idx" ON "ProductionRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionRequest_caseId_requestNumber_key" ON "ProductionRequest"("caseId", "requestNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionDocument_requestId_documentId_key" ON "ProductionDocument"("requestId", "documentId");

-- AddForeignKey
ALTER TABLE "Filing" ADD CONSTRAINT "Filing_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Filing" ADD CONSTRAINT "Filing_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Filing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilingDocument" ADD CONSTRAINT "FilingDocument_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "Filing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilingDocument" ADD CONSTRAINT "FilingDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilingReceipt" ADD CONSTRAINT "FilingReceipt_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "Filing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilingCorrection" ADD CONSTRAINT "FilingCorrection_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "Filing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRequest" ADD CONSTRAINT "ProductionRequest_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionDocument" ADD CONSTRAINT "ProductionDocument_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ProductionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionDocument" ADD CONSTRAINT "ProductionDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
