import { IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';

export class ScheduleHearingDto {
  @IsString() title!: string;
  @IsDateString() scheduledStart!: string;
  @IsOptional() @IsDateString() scheduledEnd?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() agenda?: string;
  @IsOptional() @IsBoolean() recordingPermitted?: boolean;
  @IsOptional() @IsString() backupContact?: string;
}

export class AddParticipantDto {
  @IsOptional() @IsString() userId?: string;
  @IsString() displayName!: string;
  @IsString() role!: string; // tribunal | party | counsel | witness | interpreter | observer
}
