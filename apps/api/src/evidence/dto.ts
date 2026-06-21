import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  EvidenceObjectionStatus,
  EvidenceTargetType,
  ExpertAppointment,
  ExpertReportKind,
  OathKind,
} from '@prisma/client';

// ---- Witnesses (Ch13) -----------------------------------------------------

export class AddWitnessDto {
  @IsString() fullName!: string;
  @IsOptional() @IsString() partyId?: string;
  @IsOptional() @IsString() capacity?: string;
  @IsOptional() @IsString() language?: string;
  @IsOptional() @IsBoolean() interpreterRequired?: boolean;
  @IsOptional() @IsString() availabilityNote?: string;
  @IsOptional() @IsBoolean() crossExaminationRequired?: boolean;
}

export class WitnessStatementDto {
  @IsString() title!: string;
  @IsOptional() @IsString() language?: string;
  @IsOptional() @IsString() documentId?: string;
}

export class RecordOathDto {
  @IsEnum(OathKind) oath!: OathKind;
  @IsOptional() @IsString() hearingAttendance?: string;
}

// ---- Experts (Ch14) -------------------------------------------------------

export class AddExpertDto {
  @IsEnum(ExpertAppointment) appointment!: ExpertAppointment;
  @IsString() fullName!: string;
  @IsString() expertise!: string;
  @IsOptional() @IsString() partyId?: string;
  @IsOptional() @IsString() instructions?: string;
  @IsOptional() @IsString() feeArrangement?: string;
}

export class DeclareIndependenceDto {
  @IsBoolean() independenceDeclared!: boolean;
  @IsBoolean() conflictDisclosed!: boolean;
}

export class ExpertReportDto {
  @IsString() title!: string;
  @IsOptional() @IsEnum(ExpertReportKind) kind?: ExpertReportKind;
  @IsOptional() @IsString() documentId?: string;
}

// ---- Evidence objections (Ch11/13/14) -------------------------------------

export class RaiseObjectionDto {
  @IsEnum(EvidenceTargetType) targetType!: EvidenceTargetType;
  @IsString() targetId!: string;
  @IsString() ground!: string;
  @IsOptional() @IsString() detail?: string;
}

export class RuleObjectionDto {
  @IsEnum(EvidenceObjectionStatus) status!: EvidenceObjectionStatus; // UPHELD | DISMISSED | DEFERRED
  @IsString() ruling!: string;
}
