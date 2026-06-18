import { SetMetadata } from '@nestjs/common';
import { Role } from '@gaap/shared';

export const ROLES_KEY = 'required_roles';

/** Require AT LEAST ONE of the listed global roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
