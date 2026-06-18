import { IsArray, IsDateString, IsOptional, IsString } from 'class-validator';

export class UpsertNewsDto {
  @IsString() title!: string;
  @IsOptional() @IsString() excerpt?: string;
  @IsString() body!: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() authorName?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
}

export class UpsertCourtHighlightDto {
  @IsString() courtName!: string;
  @IsString() jurisdiction!: string;
  @IsString() caseName!: string;
  @IsOptional() @IsString() citation?: string;
  @IsOptional() @IsDateString() decisionDate?: string;
  @IsString() legalIssue!: string;
  @IsString() summary!: string;
  @IsOptional() @IsString() outcome?: string;
  @IsOptional() @IsString() appealStatus?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() authorName?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
}

export class UpsertPublicationDto {
  @IsString() title!: string;
  @IsOptional() @IsString() abstract?: string;
  @IsOptional() @IsString() authorName?: string;
  @IsOptional() @IsString() externalUrl?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
}
