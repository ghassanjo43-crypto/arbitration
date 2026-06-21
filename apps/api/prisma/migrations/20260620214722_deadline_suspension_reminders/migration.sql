-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeadlineStatus" ADD VALUE 'SUSPENDED';
ALTER TYPE "DeadlineStatus" ADD VALUE 'WAIVED';
ALTER TYPE "DeadlineStatus" ADD VALUE 'OVERDUE';

-- AlterTable
ALTER TABLE "Deadline" ADD COLUMN     "suspendedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DeadlineReminder" (
    "id" TEXT NOT NULL,
    "deadlineId" TEXT NOT NULL,
    "offsetToken" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "escalation" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeadlineReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeadlineReminder_deadlineId_idx" ON "DeadlineReminder"("deadlineId");

-- CreateIndex
CREATE INDEX "DeadlineReminder_scheduledFor_sentAt_idx" ON "DeadlineReminder"("scheduledFor", "sentAt");

-- AddForeignKey
ALTER TABLE "DeadlineReminder" ADD CONSTRAINT "DeadlineReminder_deadlineId_fkey" FOREIGN KEY ("deadlineId") REFERENCES "Deadline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
