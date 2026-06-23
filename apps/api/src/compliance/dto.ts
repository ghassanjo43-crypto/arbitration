import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ComplianceHoldStatus, ScreeningDecision, ScreeningStatus, ScreeningSubjectType, ScreeningType } from '@prisma/client';

export class ManualScreenDto {
  @IsEnum(ScreeningSubjectType) subjectType!: ScreeningSubjectType;
  @IsString() subjectName!: string;
  @IsOptional() @IsString() subjectId?: string;
  @IsOptional() @IsString() caseId?: string;
  @IsOptional() @IsEnum(ScreeningType) screeningType?: ScreeningType;
  @IsOptional() @IsString() country?: string;
}

export class ReviewScreeningDto {
  @IsEnum(ScreeningDecision) decision!: ScreeningDecision;
  @IsOptional() @IsString() note?: string;
}

export class ReleaseHoldDto {
  @IsOptional() @IsString() note?: string;
}

export class ListChecksQuery {
  @IsOptional() @IsString() caseId?: string;
  @IsOptional() @IsEnum(ScreeningStatus) status?: ScreeningStatus;
  @IsOptional() @IsString() subjectId?: string;
}

export class ListHoldsQuery {
  @IsOptional() @IsString() caseId?: string;
  @IsOptional() @IsEnum(ComplianceHoldStatus) status?: ComplianceHoldStatus;
}
