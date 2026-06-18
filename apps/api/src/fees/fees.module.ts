import { Module } from '@nestjs/common';
import { FeeCalculatorService } from './fee-calculator.service';
import { FeesController } from './fees.controller';

@Module({
  providers: [FeeCalculatorService],
  controllers: [FeesController],
  exports: [FeeCalculatorService],
})
export class FeesModule {}
