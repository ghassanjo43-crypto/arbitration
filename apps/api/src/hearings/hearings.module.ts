import { Module } from '@nestjs/common';
import { HearingsService } from './hearings.service';
import { HearingsController } from './hearings.controller';

@Module({
  providers: [HearingsService],
  controllers: [HearingsController],
  exports: [HearingsService],
})
export class HearingsModule {}
