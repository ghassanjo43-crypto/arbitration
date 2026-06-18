import { IsEmail, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PartySide, CaseRole } from '@prisma/client';

export class UpsertPartyDto {
  @IsEnum(PartySide) side!: PartySide;
  @IsString() legalName!: string;
  @IsOptional() @IsString() legalStatus?: string;
  @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsString() countryOfIncorporation?: string;
  @IsOptional() @IsString() registrationNumber?: string;
  @IsOptional() @IsString() addressLine1?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() serviceInfo?: string;
}

export class AddRepresentativeDto {
  @IsString() fullName!: string;
  @IsOptional() @IsString() firm?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsUUID() lawyerUserId?: string;
}

export class AddTeamMemberDto {
  /** The user to add to the case team (e.g. a colleague on the same side). */
  @IsUUID() userId!: string;
  @IsEnum(CaseRole) caseRole!: CaseRole;
  @IsOptional() @IsEnum(PartySide) side?: PartySide;
}
