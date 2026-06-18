import { IsArray, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpsertLawyerProfileDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() lawFirm?: string;
  @IsOptional() @IsString() barAssociation?: string;
  @IsOptional() @IsString() barNumber?: string;
  @IsOptional() @IsString() jurisdiction?: string;
  @IsOptional() @IsInt() @Min(0) yearsOfPractice?: number;
  @IsOptional() @IsString() arbitrationExperience?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) languages?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) practiceAreas?: string[];
  @IsOptional() @IsString() profileSummary?: string;
}
