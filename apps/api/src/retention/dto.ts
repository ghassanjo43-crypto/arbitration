import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { RETENTION_CATEGORIES, RetentionCategory } from './retention-policy';

export class PlaceLegalHoldDto {
  @IsString() caseId!: string;
  @IsString() reason!: string;
}

export class ReleaseLegalHoldDto {
  @IsOptional() @IsString() note?: string;
}

export class ExecuteSweepDto {
  /** Must be exactly true — an explicit confirmation that this deletes data. */
  @IsBoolean() confirm!: boolean;
  /** Categories to act on (opt-in). Safeguarded categories are always refused. */
  @IsArray() @IsIn(RETENTION_CATEGORIES, { each: true }) categories!: RetentionCategory[];
}
