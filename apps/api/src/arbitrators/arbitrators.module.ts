import { Module } from '@nestjs/common';
import { ArbitratorsService } from './arbitrators.service';
import { ArbitratorsController } from './arbitrators.controller';

@Module({
  providers: [ArbitratorsService],
  controllers: [ArbitratorsController],
  exports: [ArbitratorsService],
})
export class ArbitratorsModule {}
