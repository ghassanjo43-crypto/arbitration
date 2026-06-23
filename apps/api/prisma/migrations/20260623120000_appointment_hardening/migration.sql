-- CreateEnum
CREATE TYPE "TribunalMemberStatus" AS ENUM ('ACTIVE', 'RESIGNED', 'REMOVED', 'INCAPACITATED', 'DECEASED', 'REPLACED');

-- CreateEnum
CREATE TYPE "VacancyReason" AS ENUM ('RESIGNATION', 'REMOVAL', 'INCAPACITY', 'DEATH', 'CHALLENGE_UPHELD');

-- CreateEnum
CREATE TYPE "AppointmentMethod" AS ENUM ('PARTY_NOMINATION', 'CO_ARBITRATOR_NOMINATION', 'INSTITUTION_DEFAULT');

-- AlterTable
ALTER TABLE "TribunalMember" ADD COLUMN     "status" "TribunalMemberStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "vacatedAt" TIMESTAMP(3),
ADD COLUMN     "vacancyReason" "VacancyReason";

-- AlterTable
ALTER TABLE "AppointmentInvitation" ADD COLUMN     "appointmentMethod" "AppointmentMethod" NOT NULL DEFAULT 'PARTY_NOMINATION',
ADD COLUMN     "reminderCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastReminderAt" TIMESTAMP(3),
ADD COLUMN     "declineReason" TEXT,
ADD COLUMN     "fillsVacancyUserId" TEXT;
