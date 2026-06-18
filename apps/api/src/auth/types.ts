import { Request } from 'express';
import { Permission, Role } from '@gaap/shared';

export interface AuthUser {
  id: string;
  email: string;
  roles: Role[];
  permissions: Permission[];
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}

export interface JwtAccessPayload {
  sub: string;
  email: string;
  roles: Role[];
  permissions: Permission[];
  type: 'access';
}

export interface JwtRefreshPayload {
  sub: string;
  sessionId: string;
  type: 'refresh';
}
