import { Module } from '@nestjs/common';
import { RulesService } from './rules.service';
import { RuleEngineService } from './rule-engine.service';
import { CaseRulesController, RulesController } from './rules.controller';

@Module({
  providers: [RulesService, RuleEngineService],
  controllers: [RulesController, CaseRulesController],
  exports: [RulesService, RuleEngineService],
})
export class RulesModule {}
