import { Role } from './roles.js';

/**
 * Global permissions. These govern institution-wide actions (managing the
 * panel, publishing news, system settings). Case-scoped authorization is a
 * SEPARATE layer evaluated against case membership — see authz docs.
 */
export enum Permission {
  // Public content management
  NEWS_MANAGE = 'news:manage',
  COURT_HIGHLIGHT_MANAGE = 'court_highlight:manage',
  PUBLICATION_MANAGE = 'publication:manage',

  // Case administration (institutional)
  CASE_VIEW_QUEUE = 'case:view_queue',
  CASE_REGISTER = 'case:register',
  CASE_ISSUE_DEFICIENCY = 'case:issue_deficiency',
  CASE_MANAGE_SERVICE = 'case:manage_service',
  CASE_MANAGE_DEADLINES = 'case:manage_deadlines',
  CASE_SCHEDULE_HEARING = 'case:schedule_hearing',

  // Tribunal & panel
  APPOINTMENT_MANAGE = 'appointment:manage',
  ARBITRATOR_APPROVE = 'arbitrator:approve',
  ARBITRATOR_SUSPEND = 'arbitrator:suspend',
  CHALLENGE_DECIDE = 'challenge:decide',
  CONFLICT_REVIEW = 'conflict:review',

  // Tribunal deliberation (only ever granted via case membership, but the
  // capability is named here for the matrix/UX). Holding this global flag is
  // NEVER sufficient on its own.
  DELIBERATION_PARTICIPATE = 'deliberation:participate',

  // Finance
  PAYMENT_RECORD = 'payment:record',
  INVOICE_MANAGE = 'invoice:manage',
  FEE_SCHEDULE_MANAGE = 'fee_schedule:manage',

  // Compliance / quality
  COMPLIANCE_REVIEW = 'compliance:review',
  POLICY_MANAGE = 'policy:manage',

  // Platform administration
  USER_MANAGE = 'user:manage',
  ROLE_MANAGE = 'role:manage',
  AUDIT_VIEW = 'audit:view',
  SETTINGS_MANAGE = 'settings:manage',
  SUPPORT_MANAGE = 'support:manage',
}

/**
 * Default global permissions per role. Deliberation is intentionally NOT here
 * for any staff role: it is only obtainable by being an appointed tribunal
 * member on a specific case.
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.INDIVIDUAL]: [],
  [Role.COMPANY_CLIENT]: [],
  [Role.LAWYER]: [],
  [Role.ARBITRATOR]: [],
  [Role.REGISTRAR]: [
    Permission.CASE_VIEW_QUEUE,
    Permission.CASE_REGISTER,
    Permission.CASE_ISSUE_DEFICIENCY,
    Permission.CASE_MANAGE_SERVICE,
    Permission.CASE_MANAGE_DEADLINES,
    Permission.CASE_SCHEDULE_HEARING,
    Permission.APPOINTMENT_MANAGE,
    Permission.CONFLICT_REVIEW,
    Permission.PAYMENT_RECORD,
    Permission.INVOICE_MANAGE,
    Permission.SUPPORT_MANAGE,
  ],
  [Role.COUNCIL_MEMBER]: [
    Permission.ARBITRATOR_APPROVE,
    Permission.ARBITRATOR_SUSPEND,
    Permission.CHALLENGE_DECIDE,
    Permission.CONFLICT_REVIEW,
    Permission.COMPLIANCE_REVIEW,
    Permission.POLICY_MANAGE,
  ],
  [Role.ADMIN]: [
    Permission.NEWS_MANAGE,
    Permission.COURT_HIGHLIGHT_MANAGE,
    Permission.PUBLICATION_MANAGE,
    Permission.USER_MANAGE,
    Permission.SUPPORT_MANAGE,
    Permission.FEE_SCHEDULE_MANAGE,
    Permission.AUDIT_VIEW,
  ],
  [Role.SUPER_ADMIN]: [
    // Super admin holds platform-configuration powers, but note: NO
    // deliberation access and confidential merits browsing is still gated by
    // case membership + explicit break-glass auditing at the service layer.
    Permission.USER_MANAGE,
    Permission.ROLE_MANAGE,
    Permission.SETTINGS_MANAGE,
    Permission.AUDIT_VIEW,
    Permission.FEE_SCHEDULE_MANAGE,
    Permission.NEWS_MANAGE,
    Permission.COURT_HIGHLIGHT_MANAGE,
    Permission.PUBLICATION_MANAGE,
    Permission.SUPPORT_MANAGE,
  ],
};

export function permissionsForRoles(roles: Role[]): Permission[] {
  const set = new Set<Permission>();
  for (const r of roles) {
    for (const p of ROLE_PERMISSIONS[r] ?? []) set.add(p);
  }
  return [...set];
}
