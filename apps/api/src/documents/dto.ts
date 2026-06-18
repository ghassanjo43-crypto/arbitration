import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ConfidentialityLevel, DocumentCategory } from '@gaap/shared';
import { PartySide } from '@prisma/client';

export class UploadDocumentDto {
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsEnum(DocumentCategory) category!: DocumentCategory;
  @IsOptional() @IsEnum(ConfidentialityLevel) confidentiality?: ConfidentialityLevel;
  @IsOptional() @IsEnum(PartySide) visibleToSide?: PartySide;
  @IsOptional() @IsString() exhibitNumber?: string;
}

/** Minimal shape of a multer-uploaded file (avoids a separate @types/multer dep). */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
