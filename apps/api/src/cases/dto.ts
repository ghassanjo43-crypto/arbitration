import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { FILING_CAPACITIES, FilingCapacity } from '@gaap/shared';

export class PartyInput {
  @IsString() legalName!: string;
  @IsOptional() @IsString() legalStatus?: string;
  @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() registrationNumber?: string;
  @IsOptional() @IsString() serviceInfo?: string;
}

export class CreateCaseDraftDto {
  @IsString() title!: string;

  @IsEnum(FILING_CAPACITIES as unknown as object, { message: 'Invalid filing capacity.' })
  @IsOptional()
  filingCapacity?: FilingCapacity;

  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() industry?: string;
  @IsOptional() @IsString() seat?: string;
  @IsOptional() @IsString() governingLaw?: string;
  @IsOptional() @IsString() language?: string;
  @IsOptional() @IsNumber() @Min(1) numberOfArbitrators?: number;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PartyInput)
  claimants?: PartyInput[];

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PartyInput)
  respondents?: PartyInput[];

  @IsOptional() @IsBoolean() onlineConsent?: boolean;
  @IsOptional() @IsBoolean() electronicServiceConsent?: boolean;
}

export class SubmitCaseDto {
  @IsBoolean() informationAccurate!: boolean;
  @IsBoolean() authorisedToFile!: boolean;
  @IsBoolean() acceptPortalTerms!: boolean;
  @IsBoolean() understandsJurisdiction!: boolean;
  @IsBoolean() understandsNoEnforcementGuarantee!: boolean;
  @IsBoolean() acceptElectronicService!: boolean;
}

export class DeliberationNoteDto {
  @IsString() body!: string;
}

/**
 * Registrar/administrative edit of a case's NON-MERITS administrative fields.
 * Deliberately excludes anything touching the substance of the dispute or the
 * tribunal — only logistical/administrative metadata can be corrected here.
 */
export class UpdateCaseAdminDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() industry?: string;
  @IsOptional() @IsString() seat?: string;
  @IsOptional() @IsString() governingLaw?: string;
  @IsOptional() @IsString() language?: string;
  @IsOptional() @IsNumber() @Min(1) numberOfArbitrators?: number;
  @IsOptional() @IsString() appointmentMechanism?: string;
  @IsOptional() @IsString() confidentialitySensitivity?: string;
}

export class AddCaseNoteDto {
  @IsString() note!: string;
}

export class ProceduralOrderDto {
  @IsString() title!: string;
  @IsString() body!: string;
}
