import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateDeadlineDto {
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsDateString() dueAt!: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() reminderRule?: string;
}

export class ExtendDeadlineDto {
  @IsDateString() extendedTo!: string;
}
