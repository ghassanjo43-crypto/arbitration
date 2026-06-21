import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ExpeditedBasis, JoinderType } from '@prisma/client';

// ---- Expedited (Ch23) -----------------------------------------------------

export class ProposeExpeditedDto {
  @IsEnum(ExpeditedBasis) basis!: ExpeditedBasis;
  @IsOptional() @IsBoolean() soleArbitrator?: boolean;
  @IsOptional() @IsBoolean() documentsOnly?: boolean;
  @IsOptional() @IsInt() @Min(1) pageLimit?: number;
  @IsOptional() @IsInt() @Min(1) awardTargetDays?: number;
  @IsOptional() @IsInt() @Min(1) deadlineScalePercent?: number;
  @IsOptional() @IsBoolean() simplifiedFeeSchedule?: boolean;
}

export class ExpeditedConsentDto {
  @IsBoolean() consented!: boolean;
  @IsOptional() @IsString() partyId?: string;
  @IsOptional() @IsString() note?: string;
}

export class TerminateExpeditedDto {
  @IsString() reason!: string;
}

// ---- Multi-party (Ch24) ---------------------------------------------------

export class JoinderRequestDto {
  @IsEnum(JoinderType) type!: JoinderType;
  @IsString() subjectDescription!: string;
  @IsOptional() @IsString() relatedCaseRef?: string;
  @IsOptional() @IsString() requestingPartyId?: string;
  @IsOptional() @IsString() grounds?: string;
}

export class JoinderCommentDto {
  @IsString() comment!: string;
  @IsOptional() @IsString() partyId?: string;
}

export class DecideJoinderDto {
  @IsBoolean() grant!: boolean;
  @IsString() reason!: string;
  @IsOptional() @IsString() feeReallocationNote?: string;
}
