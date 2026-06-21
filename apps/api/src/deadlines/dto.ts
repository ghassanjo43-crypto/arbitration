import { IsDateString, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateDeadlineDto {
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsDateString() dueAt!: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() reminderRule?: string;
}

export class ExtendDeadlineDto {
  @IsDateString() extendedTo!: string;
  /** Mandatory: extensions are never silent. */
  @IsString() reason!: string;
  @IsOptional() @IsString() orderReference?: string;
}

/** Suspend, resume or waive a deadline. Reason is always mandatory. */
export class DeadlineChangeDto {
  @IsString() reason!: string;
  @IsOptional() @IsString() orderReference?: string;
}

/** Generate a deadline from a rule deadline definition + a procedural event. */
export class GenerateDeadlineDto {
  @IsString() definitionKey!: string;
  /** The procedural event whose date starts the clock. */
  @IsString() triggerEventId!: string;
}

/** Ad hoc compute helper exposed for previews (does not persist). */
export class ComputeDeadlineDto {
  @IsDateString() triggerDate!: string;
  @IsInt() @Min(1) days!: number;
  @IsIn(['CALENDAR', 'BUSINESS']) dayKind!: 'CALENDAR' | 'BUSINESS';
  @IsString() timezone!: string;
  @IsOptional() @IsString() holidayCalendarId?: string;
}
