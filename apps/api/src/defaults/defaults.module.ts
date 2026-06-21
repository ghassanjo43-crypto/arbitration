import { Module } from '@nestjs/common';
import { DefaultsService } from './defaults.service';
import { DefaultsController } from './defaults.controller';

@Module({
  providers: [DefaultsService],
  controllers: [DefaultsController],
  exports: [DefaultsService],
})
export class DefaultsModule {}
