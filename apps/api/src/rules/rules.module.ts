import { Module } from '@nestjs/common';
import { RulesService } from './rules.service';
import { CaseRulesController, RulesController } from './rules.controller';

@Module({
  providers: [RulesService],
  controllers: [RulesController, CaseRulesController],
  exports: [RulesService],
})
export class RulesModule {}
