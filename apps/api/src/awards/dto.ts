import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AwardType, CorrectionKind } from '@prisma/client';

export class CreateAwardDto {
  @IsEnum(AwardType) type!: AwardType;
  @IsOptional() @IsString() seat?: string;
}

export class SignAwardDto {
  @IsOptional() @IsString() signedDocumentKey?: string;
  @IsOptional() @IsString() signatureMetadata?: string;
}

export class GenerateAwardDocumentDto {
  /** Optional operative/award text inserted by the tribunal into the PDF. */
  @IsOptional() @IsString() body?: string;
}

export class CorrectionRequestDto {
  @IsEnum(CorrectionKind) kind!: CorrectionKind;
  @IsString() details!: string;
}
