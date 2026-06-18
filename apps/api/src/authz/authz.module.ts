import { Global, Module } from '@nestjs/common';
import { CaseAccessService } from './case-access.service';
import { RolesGuard } from './roles.guard';
import { PermissionsGuard } from './permissions.guard';

@Global()
@Module({
  providers: [CaseAccessService, RolesGuard, PermissionsGuard],
  exports: [CaseAccessService, RolesGuard, PermissionsGuard],
})
export class AuthzModule {}
