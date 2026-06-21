import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { DefaultNoticeKind, DefaultOutcome, DefaultReviewFactor } from '@prisma/client';

export class OpenDefaultDto {
  @IsString() defaultingParticipant!: string;
  @IsString() basis!: string;
  @IsOptional() @IsString() defaultingPartyId?: string;
}

export class DefaultNoticeDto {
  @IsEnum(DefaultNoticeKind) kind!: DefaultNoticeKind;
  @IsString() body!: string;
  @IsOptional() @IsDateString() deadlineAt?: string;
}

export class ReviewFactorDto {
  @IsEnum(DefaultReviewFactor) factor!: DefaultReviewFactor;
  @IsBoolean() satisfied!: boolean;
  @IsOptional() @IsString() note?: string;
}

export class RegistrarReportDto {
  @IsString() summary!: string;
  @IsBoolean() serviceVerified!: boolean;
}

export class DefaultDecisionDto {
  @IsEnum(DefaultOutcome) outcome!: DefaultOutcome;
  @IsString() reason!: string;
  @IsOptional() @IsBoolean() defaultHearingScheduled?: boolean;
  @IsOptional() @IsString() proceduralOrderRef?: string;
}
