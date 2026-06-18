import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission } from '@gaap/shared';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { AuthenticatedRequest } from '../auth/types';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const held = new Set(req.user?.permissions ?? []);
    const ok = required.every((p) => held.has(p));
    if (!ok) {
      throw new ForbiddenException('Insufficient permissions for this action.');
    }
    return true;
  }
}
