import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { InterimMeasureType, InterimStatus, InterimUrgency } from '@prisma/client';

export class ApplyInterimDto {
  @IsEnum(InterimMeasureType) type!: InterimMeasureType;
  @IsString() reliefSought!: string;
  @IsOptional() @IsString() grounds?: string;
  @IsOptional() @IsEnum(InterimUrgency) urgency?: InterimUrgency;
  @IsOptional() @IsString() applicantPartyId?: string;
}

export class InterimDetailDto {
  @IsString() detail!: string;
}

export class DecideInterimDto {
  @IsIn([InterimStatus.GRANTED, InterimStatus.GRANTED_IN_PART, InterimStatus.DENIED])
  decision!: InterimStatus;
  @IsString() reason!: string;
}
