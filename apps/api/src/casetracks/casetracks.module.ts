import { Module } from '@nestjs/common';
import { ExpeditedService } from './expedited.service';
import { MultiPartyService } from './multiparty.service';
import { ExpeditedController, MultiPartyController } from './casetracks.controller';

@Module({
  providers: [ExpeditedService, MultiPartyService],
  controllers: [ExpeditedController, MultiPartyController],
  exports: [ExpeditedService, MultiPartyService],
})
export class CaseTracksModule {}
