import { Module } from '@nestjs/common';
import { FilingsService } from './filings.service';
import { ProductionService } from './production.service';
import { FilingsController, ProductionController } from './filings.controller';
import { RulesModule } from '../rules/rules.module';

@Module({
  imports: [RulesModule], // RuleEngineService: a filing is a procedural event
  providers: [FilingsService, ProductionService],
  controllers: [FilingsController, ProductionController],
  exports: [FilingsService, ProductionService],
})
export class FilingsModule {}
