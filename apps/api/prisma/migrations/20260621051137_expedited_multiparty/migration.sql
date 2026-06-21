-- CreateEnum
CREATE TYPE "ExpeditedBasis" AS ENUM ('PARTY_AGREEMENT', 'RULES_THRESHOLD', 'OTHER_LEGAL_BASIS');

-- CreateEnum
CREATE TYPE "ExpeditedStatus" AS ENUM ('PROPOSED', 'AGREED', 'ACTIVE', 'DECLINED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "JoinderType" AS ENUM ('CONSOLIDATION', 'JOINDER');

-- CreateEnum
CREATE TYPE "JoinderStatus" AS ENUM ('REQUESTED', 'COMMENTS_OPEN', 'GRANTED', 'DENIED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "ExpeditedTrack" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "basis" "ExpeditedBasis" NOT NULL,
    "status" "ExpeditedStatus" NOT NULL DEFAULT 'PROPOSED',
    "soleArbitrator" BOOLEAN NOT NULL DEFAULT true,
    "documentsOnly" BOOLEAN NOT NULL DEFAULT false,
    "pageLimit" INTEGER,
    "awardTargetDays" INTEGER,
    "deadlineScalePercent" INTEGER NOT NULL DEFAULT 50,
    "simplifiedFeeSchedule" BOOLEAN NOT NULL DEFAULT true,
    "proposedById" TEXT NOT NULL,
    "activatedById" TEXT,
    "activatedAt" TIMESTAMP(3),
    "terminatedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpeditedTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpeditedConsent" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "partyId" TEXT,
    "consented" BOOLEAN NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpeditedConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyJoinderRequest" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" "JoinderType" NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "subjectDescription" TEXT NOT NULL,
    "relatedCaseRef" TEXT,
    "requestingPartyId" TEXT,
    "requestedById" TEXT NOT NULL,
    "grounds" TEXT,
    "status" "JoinderStatus" NOT NULL DEFAULT 'REQUESTED',
    "decision" TEXT,
    "decisionReason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "feeReallocationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyJoinderRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JoinderComment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "authorById" TEXT NOT NULL,
    "partyId" TEXT,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JoinderComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpeditedTrack_caseId_key" ON "ExpeditedTrack"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpeditedConsent_trackId_userId_key" ON "ExpeditedConsent"("trackId", "userId");

-- CreateIndex
CREATE INDEX "PartyJoinderRequest_caseId_idx" ON "PartyJoinderRequest"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "PartyJoinderRequest_caseId_requestNumber_key" ON "PartyJoinderRequest"("caseId", "requestNumber");

-- CreateIndex
CREATE INDEX "JoinderComment_requestId_idx" ON "JoinderComment"("requestId");

-- AddForeignKey
ALTER TABLE "ExpeditedTrack" ADD CONSTRAINT "ExpeditedTrack_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpeditedConsent" ADD CONSTRAINT "ExpeditedConsent_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "ExpeditedTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyJoinderRequest" ADD CONSTRAINT "PartyJoinderRequest_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JoinderComment" ADD CONSTRAINT "JoinderComment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PartyJoinderRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
