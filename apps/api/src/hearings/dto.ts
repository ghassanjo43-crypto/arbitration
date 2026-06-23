import { IsBoolean, IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
import { HearingStatus } from '@prisma/client';

export class ScheduleHearingDto {
  @IsString() title!: string;
  @IsDateString() scheduledStart!: string;
  @IsOptional() @IsDateString() scheduledEnd?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() agenda?: string;
  @IsOptional() @IsBoolean() recordingPermitted?: boolean;
  @IsOptional() @IsString() backupContact?: string;
}

export class UpdateHearingDto {
  @IsOptional() @IsDateString() scheduledStart?: string;
  @IsOptional() @IsDateString() scheduledEnd?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() agenda?: string;
  @IsOptional() @IsBoolean() recordingPermitted?: boolean;
  @IsOptional() @IsString() backupContact?: string;
  @IsOptional() @IsIn([HearingStatus.SCHEDULED, HearingStatus.CONFIRMED, HearingStatus.IN_PROGRESS, HearingStatus.COMPLETED, HearingStatus.ADJOURNED])
  status?: HearingStatus;
}

export class AddParticipantDto {
  @IsOptional() @IsString() userId?: string;
  @IsString() displayName!: string;
  @IsString() role!: string; // tribunal | party | counsel | witness | interpreter | observer
}

export class AttendanceDto {
  @IsIn(['join', 'leave']) action!: 'join' | 'leave';
}
