import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

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
