import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { ConfidentialityLevel, FilingType, ProductionStatus } from '@prisma/client';

// ---- Filings (Ch10) -------------------------------------------------------

export class SubmitFilingDto {
  @IsEnum(FilingType) type!: FilingType;
  @IsString() title!: string;
  @IsOptional() @IsString() partyId?: string;
  @IsOptional() @IsString() representativeUserId?: string;
  @IsOptional() @IsString() officialTimezone?: string;
  @IsOptional() @IsString() contentHash?: string;
  @IsOptional() @IsEnum(ConfidentialityLevel) confidentiality?: ConfidentialityLevel;
  @IsOptional() @IsArray() @IsString({ each: true }) documentIds?: string[];
}

export class RequestCorrectionDto {
  @IsString() reason!: string;
}

export class DecideCorrectionDto {
  @IsBoolean() approve!: boolean;
  @IsOptional() @IsString() contentHash?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) documentIds?: string[];
}

// ---- Document production (Ch12) -------------------------------------------

export class CreateProductionRequestDto {
  @IsString() category!: string;
  @IsOptional() @IsString() requestingPartyId?: string;
  @IsOptional() @IsString() relevance?: string;
  @IsOptional() @IsString() materiality?: string;
}

export class ObjectProductionDto {
  @IsString() objection!: string;
  @IsOptional() @IsString() privilegeClaim?: string;
}

export class ReplyProductionDto {
  @IsString() reply!: string;
}

export class DecideProductionDto {
  @IsEnum(ProductionStatus) decision!: ProductionStatus; // GRANTED | GRANTED_IN_PART | DENIED
  @IsString() reason!: string;
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() @IsString() confidentialityOrder?: string;
}

export class ProduceDocumentsDto {
  @IsArray() @IsString({ each: true }) documentIds!: string[];
}

export class NonComplianceDto {
  @IsString() note!: string;
}
