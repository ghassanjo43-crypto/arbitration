import { IsArray, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { FeeCategory } from '@gaap/shared';
import { PartySide } from '@prisma/client';

export class CreateInvoiceDto {
  @IsString() currency!: string;
  @IsNumber() @Min(0) subtotal!: number;
  @IsOptional() @IsNumber() @Min(0) tax?: number;
  @IsOptional() @IsString() dueAt?: string;
}

export class AllocationInput {
  @IsUUID() partyId!: string;
  @IsOptional() @IsEnum(PartySide) side?: PartySide;
  @IsNumber() @Min(0) shareAmount!: number;
}

export class AllocateDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => AllocationInput)
  allocations!: AllocationInput[];
}

export class RecordPaymentDto {
  @IsEnum(FeeCategory) category!: FeeCategory;
  @IsNumber() @Min(0) amount!: number;
  @IsString() currency!: string;
  @IsOptional() @IsUUID() invoiceId?: string;
  /** One party may pay another party's share without prejudice to the final costs decision. */
  @IsOptional() @IsUUID() paidByUserId?: string;
  @IsOptional() @IsUUID() onBehalfOfPartyId?: string;
}
