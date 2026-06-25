import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BootstrapController } from './bootstrap.controller';
import { BootstrapStatusController } from './bootstrap-status.controller';

/**
 * Operational admin endpoints: the guarded one-shot demo bootstrap (see
 * bootstrap.controller.ts) and an unconditional status probe used to verify the
 * route is actually deployed (bootstrap-status.controller.ts). Imports AuthModule
 * to reuse the exported PasswordService so demo password hashes match the login
 * verifier.
 */
@Module({
  imports: [AuthModule],
  controllers: [BootstrapController, BootstrapStatusController],
})
export class AdminModule {}
