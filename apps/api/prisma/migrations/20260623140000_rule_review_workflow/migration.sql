-- CreateEnum
CREATE TYPE "RuleReviewStatus" AS ENUM ('PENDING', 'OK', 'CHANGE_REQUIRED', 'BLOCKER');

-- CreateTable
CREATE TABLE "RuleReviewItem" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "status" "RuleReviewStatus" NOT NULL DEFAULT 'PENDING',
    "jurisdiction" TEXT,
    "note" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RuleReviewItem_versionId_idx" ON "RuleReviewItem"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleReviewItem_versionId_ruleId_key" ON "RuleReviewItem"("versionId", "ruleId");

-- AddForeignKey
ALTER TABLE "RuleReviewItem" ADD CONSTRAINT "RuleReviewItem_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "RuleSetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleReviewItem" ADD CONSTRAINT "RuleReviewItem_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
