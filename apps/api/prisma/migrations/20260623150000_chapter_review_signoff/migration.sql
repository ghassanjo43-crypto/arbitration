-- AlterEnum
ALTER TYPE "RuleVersionStatus" ADD VALUE 'ARCHIVED';

-- CreateEnum
CREATE TYPE "VersionReviewState" AS ENUM ('NOT_STARTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'BLOCKED', 'APPROVED');

-- CreateEnum
CREATE TYPE "ChapterReviewStatus" AS ENUM ('NO_ISSUE', 'COMMENT', 'CHANGE_REQUESTED', 'BLOCKER', 'APPROVED');

-- AlterTable
ALTER TABLE "RuleSetVersion" ADD COLUMN     "reviewState" "VersionReviewState" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "signedOffById" TEXT,
ADD COLUMN     "signedOffAt" TIMESTAMP(3),
ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RuleChapterReview" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "status" "ChapterReviewStatus" NOT NULL DEFAULT 'NO_ISSUE',
    "jurisdiction" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleChapterReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleReviewComment" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "chapterId" TEXT,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ChapterReviewStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleReviewComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RuleChapterReview_versionId_idx" ON "RuleChapterReview"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleChapterReview_versionId_chapterId_key" ON "RuleChapterReview"("versionId", "chapterId");

-- CreateIndex
CREATE INDEX "RuleReviewComment_versionId_idx" ON "RuleReviewComment"("versionId");

-- AddForeignKey
ALTER TABLE "RuleChapterReview" ADD CONSTRAINT "RuleChapterReview_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "RuleSetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleChapterReview" ADD CONSTRAINT "RuleChapterReview_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "RuleChapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleReviewComment" ADD CONSTRAINT "RuleReviewComment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "RuleSetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
