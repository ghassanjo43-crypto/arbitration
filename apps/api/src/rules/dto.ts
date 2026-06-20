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
