import { Module } from '@nestjs/common';
import { EvidenceService } from './evidence.service';
import { ExpertsService } from './experts.service';
import { EvidenceController } from './evidence.controller';

@Module({
  providers: [EvidenceService, ExpertsService],
  controllers: [EvidenceController],
  exports: [EvidenceService, ExpertsService],
})
export class EvidenceModule {}
