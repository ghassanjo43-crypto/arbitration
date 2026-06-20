import { Module } from '@nestjs/common';
import { FeeCalculatorService } from './fee-calculator.service';
import { FeesController } from './fees.controller';
import { DepositsService } from './deposits.service';
import { DepositsController, FeeSchedulesController } from './deposits.controller';

@Module({
  providers: [FeeCalculatorService, DepositsService],
  controllers: [FeesController, FeeSchedulesController, DepositsController],
  exports: [FeeCalculatorService, DepositsService],
})
export class FeesModule {}
