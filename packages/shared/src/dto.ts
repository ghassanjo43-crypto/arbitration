import { Role, CaseRole } from './roles.js';
import { Permission } from './permissions.js';
import { CaseStage } from './case.js';

/** Wire contracts shared between API and web client. Keep in sync with NestJS DTOs. */

export interface AuthTokens {
  accessToken: string;
  /** Refresh token is delivered via httpOnly cookie in production; field kept for dev. */
  refreshToken?: string;
  expiresIn: number;
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  roles: Role[];
  permissions: Permission[];
  preferredLanguage: string;
  mfaEnabled: boolean;
  emailVerified: boolean;
  status: UserStatus;
}

export enum UserStatus {
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DEACTIVATED = 'DEACTIVATED',
}

export interface CaseSummary {
  id: string;
  reference: string;
  title: string;
  stage: CaseStage;
  myCaseRoles: CaseRole[];
  nextDeadlineAt: string | null;
  updatedAt: string;
}

export interface ApiError {
  statusCode: number;
  message: string | string[];
  error: string;
  correlationId?: string;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
