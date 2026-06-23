import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ChapterReviewStatus, RuleReviewStatus } from '@prisma/client';

/** Pin a case to a specific rule set version (registrar action). */
export class AssignRuleSetDto {
  @IsString() ruleSetVersionId!: string;
  @IsOptional() @IsObject() agreedModifications?: Record<string, unknown>;
}

/**
 * Formal, immutable acceptance of the applicable rules by a party/representative.
 * Captures the procedural choices and evidentiary metadata the spec requires.
 */
export class AcceptRulesDto {
  @IsOptional() @IsString() partyRepresented?: string;
  @IsOptional() @IsString() representativeAuthority?: string;
  @IsOptional() @IsString() acceptedLanguage?: string;
  @IsOptional() @IsString() seat?: string;
  @IsOptional() @IsString() governingLaw?: string;
  @IsOptional() @IsString() languageOfProceedings?: string;
  @IsOptional() @IsInt() @Min(1) numberOfArbitrators?: number;
  @IsOptional() @IsString() appointmentMethod?: string;
  @IsOptional() @IsBoolean() consentElectronicService?: boolean;
  @IsOptional() @IsBoolean() consentOnlineHearings?: boolean;
  @IsOptional() @IsString() feeAllocationAgreement?: string;
  @IsOptional() @IsObject() acceptedModifications?: Record<string, unknown>;
  @IsOptional() @IsObject() signatureMetadata?: Record<string, unknown>;
}

/** Record a procedural event (drives the rules engine / deadlines). */
export class RecordEventDto {
  @IsString() type!: string;
  @IsOptional() @IsString() ruleId?: string;
  @IsOptional() @Type(() => Date) effectiveDate?: Date;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

/**
 * Record an authorised, agreed modification of a rule for ONE case. Immutable:
 * the engine preserves the original value alongside the override and authority.
 */
export class RecordOverrideDto {
  @IsString() ruleId!: string;
  @IsString() field!: string;
  @IsString() overrideValue!: string;
  @IsOptional() @IsString() originalValue?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() authorityBasis?: string; // PARTY_AGREEMENT | TRIBUNAL_DIRECTION
}

/**
 * Record a tribunal/mandatory-law exception: a procedural step modified to
 * preserve fairness/due process, or displaced by mandatory law of the seat.
 */
export class RecordExceptionDto {
  @IsOptional() @IsString() ruleId?: string;
  @IsString() reason!: string;
  @IsOptional() @IsBoolean() mandatoryLaw?: boolean;
  @IsOptional() @IsString() authorityBasis?: string; // TRIBUNAL | APPOINTING_AUTHORITY | MANDATORY_LAW
}

// ---------------------------------------------------------------------------
// COUNSEL-REVIEW WORKFLOW (authoring / diff / versioning)
// ---------------------------------------------------------------------------

/** Create a new DRAFT version by cloning an existing one (authoring tool). */
export class CreateDraftVersionDto {
  @IsString() fromVersionId!: string;
  @IsString() version!: string; // new semantic label, e.g. "2.0-draft"
  @IsOptional() @IsString() changeSummary?: string;
  @IsOptional() @IsString() changeSummaryAr?: string;
}

/** Edit a rule's textual content. Permitted only while the version is DRAFT. */
export class UpdateRuleTextDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() titleAr?: string;
  @IsOptional() @IsString() text?: string;
  @IsOptional() @IsString() textAr?: string;
  @IsOptional() @IsString() mandatoryLawWarning?: string;
  @IsOptional() @IsBoolean() publicVisible?: boolean;
}

/** Record counsel's review decision for one rule in a draft version. */
export class RecordReviewDto {
  @IsEnum(RuleReviewStatus) status!: RuleReviewStatus; // OK | CHANGE_REQUIRED | BLOCKER | PENDING
  @IsOptional() @IsString() jurisdiction?: string;
  @IsOptional() @IsString() note?: string;
}

/** Record counsel's review decision for one CHAPTER in a draft version. */
export class RecordChapterReviewDto {
  // NO_ISSUE | COMMENT | CHANGE_REQUESTED | BLOCKER | APPROVED
  @IsEnum(ChapterReviewStatus) status!: ChapterReviewStatus;
  @IsOptional() @IsString() jurisdiction?: string;
  @IsOptional() @IsString() comment?: string;
}

/** Append a reviewer comment (on a chapter, or the version as a whole). */
export class AddReviewCommentDto {
  @IsOptional() @IsString() chapterId?: string;
  @IsString() body!: string;
}
