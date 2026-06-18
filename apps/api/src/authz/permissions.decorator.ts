import { SetMetadata } from '@nestjs/common';
import { Permission } from '@gaap/shared';

export const PERMISSIONS_KEY = 'required_permissions';

/** Require ALL listed global permissions to access the handler. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
