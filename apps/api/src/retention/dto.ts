import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { EDITABLE_BEHAVIORS, RETENTION_CATEGORIES, RetentionBehavior, RetentionCategory } from './retention-policy';

export class PlaceLegalHoldDto {
  @IsString() caseId!: string;
  @IsString() reason!: string;
}

export class ReleaseLegalHoldDto {
  @IsOptional() @IsString() note?: string;
}

export class ExecuteSweepDto {
  /** Must be exactly true — an explicit confirmation that this deletes data. */
  @IsBoolean() confirm!: boolean;
  /** Categories to act on (opt-in). Safeguarded categories are always refused. */
  @IsArray() @IsIn(RETENTION_CATEGORIES, { each: true }) categories!: RetentionCategory[];
}

/** A single category change within a policy draft. */
export class PolicyEntryDto {
  @IsIn(RETENTION_CATEGORIES) category!: RetentionCategory;
  @IsOptional() @IsInt() @Min(0) days?: number;
  @IsOptional() @IsIn(EDITABLE_BEHAVIORS) behavior?: RetentionBehavior;
  @IsOptional() @IsString() note?: string;
}

/** Draft a policy change (Super Admin). Optionally submit it for legal/council review. */
export class DraftPolicyDto {
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => PolicyEntryDto)
  entries!: PolicyEntryDto[];
  /** When true, the draft is submitted for review (PENDING_REVIEW) rather than left as DRAFT. */
  @IsOptional() @IsBoolean() submitForReview?: boolean;
}

/** Review decision on a pending policy draft (Council / legal reviewer). */
export class ReviewPolicyDto {
  @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @IsOptional() @IsString() note?: string;
}
