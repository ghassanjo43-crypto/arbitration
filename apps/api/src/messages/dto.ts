import { IsEnum, IsString, MaxLength } from 'class-validator';
import { MessageCategory } from '@prisma/client';

export class SendMessageDto {
  @IsEnum(MessageCategory) category!: MessageCategory;
  @IsString() @MaxLength(300) subject!: string;
  @IsString() @MaxLength(20000) body!: string;
}
