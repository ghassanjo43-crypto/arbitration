import { Module } from '@nestjs/common';
import { AwardsService } from './awards.service';
import { AwardsController } from './awards.controller';

@Module({
  providers: [AwardsService],
  controllers: [AwardsController],
  exports: [AwardsService],
})
export class AwardsModule {}
