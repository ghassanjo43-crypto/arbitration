import { Module } from '@nestjs/common';
import { InterimService } from './interim.service';
import { InterimController } from './interim.controller';

@Module({
  providers: [InterimService],
  controllers: [InterimController],
  exports: [InterimService],
})
export class InterimModule {}
