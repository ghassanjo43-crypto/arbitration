import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { FeeCalculatorService } from './fee-calculator.service';

class CalculateFeeDto {
  @IsNumber() @Min(0) amountInDispute!: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsNumber() numberOfArbitrators?: number;
  @IsOptional() @IsBoolean() expedited?: boolean;
}

@ApiTags('fees')
@Controller('fees')
export class FeesController {
  constructor(private readonly calculator: FeeCalculatorService) {}

  /** Public fee calculator. */
  @Post('calculate')
  calculate(@Body() dto: CalculateFeeDto) {
    return this.calculator.calculate(dto);
  }
}
