-- CreateEnum
CREATE TYPE "DayKind" AS ENUM ('CALENDAR', 'BUSINESS');

-- CreateEnum
CREATE TYPE "DeadlineChangeKind" AS ENUM ('EXTENSION', 'SUSPENSION', 'SHORTENING', 'WAIVER', 'RESUMPTION');

-- CreateEnum
CREATE TYPE "RuleVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "RuleStatus" AS ENUM ('ACTIVE', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "NoticeType" AS ENUM ('NOTICE_OF_ARBITRATION', 'RESPONSE', 'PLEADING', 'PROCEDURAL_APPLICATION', 'TRIBUNAL_NOTICE', 'REGISTRAR_NOTICE', 'PROCEDURAL_ORDER', 'HEARING_NOTICE', 'PAYMENT_NOTICE', 'AWARD', 'CORRECTION', 'INTERPRETATION', 'DEFICIENCY_NOTICE');

-- CreateEnum
CREATE TYPE "NoticeStatus" AS ENUM ('DRAFT', 'ISSUED', 'PORTAL_AVAILABLE', 'EMAIL_SENT', 'DELIVERED', 'DELIVERY_FAILED', 'ACCESSED', 'ACKNOWLEDGED', 'SUBSTITUTE_SERVICE_REQUIRED', 'SERVICE_COMPLETED', 'SERVICE_DISPUTED');

-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('PORTAL', 'EMAIL', 'SMS', 'COURIER', 'REGISTERED_MAIL', 'PERSONAL_DELIVERY', 'PUBLICATION');

-- CreateEnum
CREATE TYPE "DeliveryOutcome" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED');

-- AlterTable
ALTER TABLE "Deadline" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "dayKind" "DayKind",
ADD COLUMN     "days" INTEGER,
ADD COLUMN     "definitionKey" TEXT,
ADD COLUMN     "holidayCalendarId" TEXT,
ADD COLUMN     "requiredAction" TEXT,
ADD COLUMN     "responsibleRole" "CaseRole",
ADD COLUMN     "ruleId" TEXT,
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "triggerDate" TIMESTAMP(3),
ADD COLUMN     "triggerEventId" TEXT;

-- CreateTable
CREATE TABLE "DeadlineExtension" (
    "id" TEXT NOT NULL,
    "deadlineId" TEXT NOT NULL,
    "kind" "DeadlineChangeKind" NOT NULL DEFAULT 'EXTENSION',
    "previousDueAt" TIMESTAMP(3) NOT NULL,
    "newDueAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "orderedById" TEXT NOT NULL,
    "orderReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeadlineExtension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HolidayCalendar" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "weekend" INTEGER[] DEFAULT ARRAY[6, 0]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HolidayCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleSet" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleAr" TEXT,
    "description" TEXT,
    "descriptionAr" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleSetVersion" (
    "id" TEXT NOT NULL,
    "ruleSetId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "RuleVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveDate" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "changeSummary" TEXT,
    "changeSummaryAr" TEXT,
    "mandatoryLawNotice" TEXT NOT NULL DEFAULT 'Mandatory provisions of the law of the seat prevail over conflicting portal rules. These rules require review by qualified arbitration counsel before production launch.',
    "mandatoryLawNoticeAr" TEXT,
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleSetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleChapter" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "titleAr" TEXT,
    "summary" TEXT,
    "summaryAr" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RuleChapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleAr" TEXT,
    "text" TEXT NOT NULL,
    "textAr" TEXT,
    "status" "RuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "triggeringEvent" TEXT,
    "responsibleRole" "CaseRole",
    "permittedAction" TEXT,
    "requiredNotice" TEXT,
    "requiredDocuments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "feeConsequence" TEXT,
    "defaultConsequence" TEXT,
    "extensionAuthority" TEXT,
    "waiverAuthority" TEXT,
    "applicableCaseTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "applicableRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "auditRequired" BOOLEAN NOT NULL DEFAULT true,
    "mandatoryLawWarning" TEXT,
    "publicVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleDeadlineDefinition" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelAr" TEXT,
    "triggerEvent" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "dayKind" "DayKind" NOT NULL DEFAULT 'CALENDAR',
    "responsibleRole" "CaseRole",
    "requiredAction" TEXT,
    "extensionAuthority" TEXT,
    "reminderRule" TEXT NOT NULL DEFAULT 'P7D,P2D,P1D',

    CONSTRAINT "RuleDeadlineDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseRuleSet" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "ruleSetVersionId" TEXT NOT NULL,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agreedModifications" TEXT,

    CONSTRAINT "CaseRuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseRuleAcceptance" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ruleSetVersionId" TEXT NOT NULL,
    "partyRepresented" TEXT,
    "representativeAuthority" TEXT,
    "acceptedLanguage" TEXT NOT NULL DEFAULT 'en',
    "seat" TEXT,
    "governingLaw" TEXT,
    "languageOfProceedings" TEXT,
    "numberOfArbitrators" INTEGER,
    "appointmentMethod" TEXT,
    "consentElectronicService" BOOLEAN NOT NULL DEFAULT false,
    "consentOnlineHearings" BOOLEAN NOT NULL DEFAULT false,
    "feeAllocationAgreement" TEXT,
    "acceptedModifications" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "authMethod" TEXT,
    "signatureMetadata" TEXT,
    "receiptNumber" TEXT NOT NULL,
    "receiptHash" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseRuleAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseProceduralEvent" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ruleId" TEXT,
    "actorUserId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveDate" TIMESTAMP(3),
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseProceduralEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormalNotice" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" "NoticeType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "NoticeStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedById" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormalNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoticeRecipient" (
    "id" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "userId" TEXT,
    "label" TEXT NOT NULL,
    "email" TEXT,
    "partyId" TEXT,
    "status" "NoticeStatus" NOT NULL DEFAULT 'ISSUED',
    "portalAvailableAt" TIMESTAMP(3),
    "firstAccessedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgementMethod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoticeRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoticeDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "outcome" "DeliveryOutcome" NOT NULL DEFAULT 'PENDING',
    "detail" TEXT,
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoticeDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoticeAccessEvent" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoticeAccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubstituteServiceOrder" (
    "id" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "method" "DeliveryChannel" NOT NULL,
    "orderedById" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubstituteServiceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCertificate" (
    "id" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "generatedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,

    CONSTRAINT "ServiceCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeadlineExtension_deadlineId_idx" ON "DeadlineExtension"("deadlineId");

-- CreateIndex
CREATE UNIQUE INDEX "HolidayCalendar_code_key" ON "HolidayCalendar"("code");

-- CreateIndex
CREATE INDEX "Holiday_calendarId_idx" ON "Holiday"("calendarId");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_calendarId_date_key" ON "Holiday"("calendarId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "RuleSet_code_key" ON "RuleSet"("code");

-- CreateIndex
CREATE INDEX "RuleSetVersion_status_idx" ON "RuleSetVersion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RuleSetVersion_ruleSetId_version_key" ON "RuleSetVersion"("ruleSetId", "version");

-- CreateIndex
CREATE INDEX "RuleChapter_versionId_idx" ON "RuleChapter"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleChapter_versionId_number_key" ON "RuleChapter"("versionId", "number");

-- CreateIndex
CREATE INDEX "Rule_versionId_idx" ON "Rule"("versionId");

-- CreateIndex
CREATE INDEX "Rule_triggeringEvent_idx" ON "Rule"("triggeringEvent");

-- CreateIndex
CREATE UNIQUE INDEX "Rule_versionId_number_key" ON "Rule"("versionId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "RuleDeadlineDefinition_ruleId_key_key" ON "RuleDeadlineDefinition"("ruleId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "CaseRuleSet_caseId_key" ON "CaseRuleSet"("caseId");

-- CreateIndex
CREATE INDEX "CaseRuleSet_ruleSetVersionId_idx" ON "CaseRuleSet"("ruleSetVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseRuleAcceptance_receiptNumber_key" ON "CaseRuleAcceptance"("receiptNumber");

-- CreateIndex
CREATE INDEX "CaseRuleAcceptance_caseId_idx" ON "CaseRuleAcceptance"("caseId");

-- CreateIndex
CREATE INDEX "CaseRuleAcceptance_userId_idx" ON "CaseRuleAcceptance"("userId");

-- CreateIndex
CREATE INDEX "CaseProceduralEvent_caseId_idx" ON "CaseProceduralEvent"("caseId");

-- CreateIndex
CREATE INDEX "CaseProceduralEvent_type_idx" ON "CaseProceduralEvent"("type");

-- CreateIndex
CREATE INDEX "FormalNotice_caseId_idx" ON "FormalNotice"("caseId");

-- CreateIndex
CREATE INDEX "FormalNotice_status_idx" ON "FormalNotice"("status");

-- CreateIndex
CREATE INDEX "NoticeRecipient_noticeId_idx" ON "NoticeRecipient"("noticeId");

-- CreateIndex
CREATE INDEX "NoticeDeliveryAttempt_recipientId_idx" ON "NoticeDeliveryAttempt"("recipientId");

-- CreateIndex
CREATE INDEX "NoticeAccessEvent_recipientId_idx" ON "NoticeAccessEvent"("recipientId");

-- CreateIndex
CREATE INDEX "SubstituteServiceOrder_noticeId_idx" ON "SubstituteServiceOrder"("noticeId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCertificate_noticeId_key" ON "ServiceCertificate"("noticeId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCertificate_certificateNumber_key" ON "ServiceCertificate"("certificateNumber");

-- AddForeignKey
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_triggerEventId_fkey" FOREIGN KEY ("triggerEventId") REFERENCES "CaseProceduralEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_holidayCalendarId_fkey" FOREIGN KEY ("holidayCalendarId") REFERENCES "HolidayCalendar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadlineExtension" ADD CONSTRAINT "DeadlineExtension_deadlineId_fkey" FOREIGN KEY ("deadlineId") REFERENCES "Deadline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "HolidayCalendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleSetVersion" ADD CONSTRAINT "RuleSetVersion_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "RuleSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleChapter" ADD CONSTRAINT "RuleChapter_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "RuleSetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "RuleSetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "RuleChapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleDeadlineDefinition" ADD CONSTRAINT "RuleDeadlineDefinition_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseRuleSet" ADD CONSTRAINT "CaseRuleSet_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseRuleSet" ADD CONSTRAINT "CaseRuleSet_ruleSetVersionId_fkey" FOREIGN KEY ("ruleSetVersionId") REFERENCES "RuleSetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseRuleAcceptance" ADD CONSTRAINT "CaseRuleAcceptance_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseRuleAcceptance" ADD CONSTRAINT "CaseRuleAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseRuleAcceptance" ADD CONSTRAINT "CaseRuleAcceptance_ruleSetVersionId_fkey" FOREIGN KEY ("ruleSetVersionId") REFERENCES "RuleSetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseProceduralEvent" ADD CONSTRAINT "CaseProceduralEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormalNotice" ADD CONSTRAINT "FormalNotice_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeRecipient" ADD CONSTRAINT "NoticeRecipient_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "FormalNotice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeDeliveryAttempt" ADD CONSTRAINT "NoticeDeliveryAttempt_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "NoticeRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeAccessEvent" ADD CONSTRAINT "NoticeAccessEvent_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "NoticeRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCertificate" ADD CONSTRAINT "ServiceCertificate_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "FormalNotice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
