import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { DeliveryChannel, NoticeType } from '@prisma/client';

export class NoticeRecipientDto {
  @IsString() label!: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() partyId?: string;
}

export class NoticeDocumentDto {
  @IsString() filename!: string;
  @IsOptional() @IsString() documentId?: string;
  @IsOptional() @IsString() contentHash?: string;
  @IsOptional() @IsInt() byteSize?: number;
}

export class IssueNoticeDto {
  @IsEnum(NoticeType) type!: NoticeType;
  @IsString() subject!: string;
  @IsString() body!: string;
  @IsOptional() @IsString() documentId?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NoticeDocumentDto)
  documents?: NoticeDocumentDto[];
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => NoticeRecipientDto)
  recipients!: NoticeRecipientDto[];
}

export class AcknowledgeNoticeDto {
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() statementText?: string;
  @IsOptional() @IsObject() signatureMetadata?: Record<string, unknown>;
}

export class SubstituteServiceDto {
  @IsEnum(DeliveryChannel) method!: DeliveryChannel;
  @IsString() instructions!: string;
}
