-- CreateEnum
CREATE TYPE "RuleActionKind" AS ENUM ('CREATE_DEADLINE', 'REQUIRE_NOTICE', 'REQUIRE_DOCUMENT', 'ASSESS_FEE', 'ADVANCE_STAGE', 'FLAG_DEFAULT', 'RECORD_COMMENCEMENT');

-- CreateEnum
CREATE TYPE "RuleExecutionStatus" AS ENUM ('EXECUTED', 'SKIPPED', 'FAILED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "RuleTrigger" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "description" TEXT,
    "descriptionAr" TEXT,
    "conditionJson" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleAction" (
    "id" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "kind" "RuleActionKind" NOT NULL,
    "definitionKey" TEXT,
    "targetKey" TEXT,
    "paramsJson" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleNoticeRequirement" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "noticeType" "NoticeType" NOT NULL,
    "recipientRole" "CaseRole",
    "description" TEXT,
    "descriptionAr" TEXT,

    CONSTRAINT "RuleNoticeRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleDocumentRequirement" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelAr" TEXT,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RuleDocumentRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleFeeDefinition" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "feeCode" TEXT NOT NULL,
    "basis" "FeeBasis" NOT NULL DEFAULT 'FLAT',
    "amount" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "description" TEXT,
    "descriptionAr" TEXT,

    CONSTRAINT "RuleFeeDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RulePermissionRequirement" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "RulePermissionRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseRuleOverride" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "originalValue" TEXT,
    "overrideValue" TEXT NOT NULL,
    "reason" TEXT,
    "authorisedById" TEXT,
    "authorityBasis" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseRuleOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseRuleException" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "ruleId" TEXT,
    "reason" TEXT NOT NULL,
    "mandatoryLaw" BOOLEAN NOT NULL DEFAULT false,
    "authorisedById" TEXT,
    "authorityBasis" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseRuleException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseRuleExecution" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "triggerEventId" TEXT,
    "actionKind" "RuleActionKind" NOT NULL,
    "status" "RuleExecutionStatus" NOT NULL DEFAULT 'EXECUTED',
    "detail" TEXT,
    "createdEntityType" TEXT,
    "createdEntityId" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseRuleExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleAuditLog" (
    "id" TEXT NOT NULL,
    "ruleSetVersionId" TEXT,
    "ruleId" TEXT,
    "caseId" TEXT,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RuleTrigger_eventType_idx" ON "RuleTrigger"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "RuleTrigger_ruleId_eventType_key" ON "RuleTrigger"("ruleId", "eventType");

-- CreateIndex
CREATE INDEX "RuleAction_triggerId_idx" ON "RuleAction"("triggerId");

-- CreateIndex
CREATE INDEX "RuleNoticeRequirement_ruleId_idx" ON "RuleNoticeRequirement"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleDocumentRequirement_ruleId_key_key" ON "RuleDocumentRequirement"("ruleId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "RuleFeeDefinition_ruleId_feeCode_key" ON "RuleFeeDefinition"("ruleId", "feeCode");

-- CreateIndex
CREATE INDEX "RulePermissionRequirement_ruleId_idx" ON "RulePermissionRequirement"("ruleId");

-- CreateIndex
CREATE INDEX "CaseRuleOverride_caseId_idx" ON "CaseRuleOverride"("caseId");

-- CreateIndex
CREATE INDEX "CaseRuleOverride_ruleId_idx" ON "CaseRuleOverride"("ruleId");

-- CreateIndex
CREATE INDEX "CaseRuleException_caseId_idx" ON "CaseRuleException"("caseId");

-- CreateIndex
CREATE INDEX "CaseRuleExecution_caseId_idx" ON "CaseRuleExecution"("caseId");

-- CreateIndex
CREATE INDEX "CaseRuleExecution_ruleId_idx" ON "CaseRuleExecution"("ruleId");

-- CreateIndex
CREATE INDEX "CaseRuleExecution_triggerEventId_idx" ON "CaseRuleExecution"("triggerEventId");

-- CreateIndex
CREATE INDEX "RuleAuditLog_caseId_idx" ON "RuleAuditLog"("caseId");

-- CreateIndex
CREATE INDEX "RuleAuditLog_ruleId_idx" ON "RuleAuditLog"("ruleId");

-- AddForeignKey
ALTER TABLE "RuleTrigger" ADD CONSTRAINT "RuleTrigger_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleAction" ADD CONSTRAINT "RuleAction_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "RuleTrigger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleNoticeRequirement" ADD CONSTRAINT "RuleNoticeRequirement_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleDocumentRequirement" ADD CONSTRAINT "RuleDocumentRequirement_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleFeeDefinition" ADD CONSTRAINT "RuleFeeDefinition_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RulePermissionRequirement" ADD CONSTRAINT "RulePermissionRequirement_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseRuleOverride" ADD CONSTRAINT "CaseRuleOverride_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseRuleOverride" ADD CONSTRAINT "CaseRuleOverride_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseRuleException" ADD CONSTRAINT "CaseRuleException_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseRuleException" ADD CONSTRAINT "CaseRuleException_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseRuleExecution" ADD CONSTRAINT "CaseRuleExecution_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseRuleExecution" ADD CONSTRAINT "CaseRuleExecution_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseRuleExecution" ADD CONSTRAINT "CaseRuleExecution_triggerEventId_fkey" FOREIGN KEY ("triggerEventId") REFERENCES "CaseProceduralEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleAuditLog" ADD CONSTRAINT "RuleAuditLog_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleAuditLog" ADD CONSTRAINT "RuleAuditLog_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
