import { Module } from '@nestjs/common';
import { RulesService } from './rules.service';
import { RuleEngineService } from './rule-engine.service';
import { RuleReviewService } from './rule-review.service';
import { CaseRulesController, RuleReviewController, RulesController } from './rules.controller';

@Module({
  providers: [RulesService, RuleEngineService, RuleReviewService],
  controllers: [RulesController, CaseRulesController, RuleReviewController],
  exports: [RulesService, RuleEngineService],
})
export class RulesModule {}
