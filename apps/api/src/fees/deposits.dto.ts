import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { AllocationMethod } from '@prisma/client';

export class CreateDepositRequestDto {
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() @Min(0) totalAmount!: number;
  @IsOptional() @IsString() currency?: string;
  @IsEnum(AllocationMethod) allocationMethod!: AllocationMethod;
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() isSupplementary?: boolean;
  /** Optional explicit weights for BY_AGREEMENT / CUSTOM, keyed by partyId. */
  @IsOptional() weights?: Record<string, number>;
}

export class RecordDepositPaymentDto {
  @IsNumber() @Min(0.01) amount!: number;
  @IsOptional() @IsString() paidByPartyId?: string;
  /** When true, another party is covering this share (substitute payment). */
  @IsOptional() substitute?: boolean;
  @IsOptional() @IsString() provider?: string;
  @IsOptional() @IsString() providerRef?: string;
}

export class RefundDto {
  @IsNumber() @Min(0.01) amount!: number;
  @IsString() reason!: string;
}
