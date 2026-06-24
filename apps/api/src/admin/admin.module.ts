import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BootstrapController } from './bootstrap.controller';

/**
 * Operational admin endpoints. Currently just the guarded one-shot demo
 * bootstrap (see bootstrap.controller.ts). Imports AuthModule to reuse the
 * exported PasswordService so demo password hashes match the login verifier.
 */
@Module({
  imports: [AuthModule],
  controllers: [BootstrapController],
})
export class AdminModule {}
