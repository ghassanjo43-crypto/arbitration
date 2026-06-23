import { Global, Module } from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import { ComplianceController } from './compliance.controller';

/**
 * Global so producer modules (registry, parties, appointments, …) can fire
 * re-screening triggers and enforce compliance holds without importing it.
 */
@Global()
@Module({
  providers: [ComplianceService],
  controllers: [ComplianceController],
  exports: [ComplianceService],
})
export class ComplianceModule {}
