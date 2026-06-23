import { Global, Module } from '@nestjs/common';
import { RetentionService } from './retention.service';
import { RetentionController } from './retention.controller';

/**
 * Global so case-deletion paths can inject RetentionService.assertNoLegalHold
 * to block deletion of a case under legal hold.
 */
@Global()
@Module({
  providers: [RetentionService],
  controllers: [RetentionController],
  exports: [RetentionService],
})
export class RetentionModule {}
