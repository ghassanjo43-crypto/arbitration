import { Module } from '@nestjs/common';
import { LawyersService } from './lawyers.service';
import { LawyersController } from './lawyers.controller';

@Module({
  providers: [LawyersService],
  controllers: [LawyersController],
  exports: [LawyersService],
})
export class LawyersModule {}
