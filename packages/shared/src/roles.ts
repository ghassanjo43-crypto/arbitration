/**
 * System roles. These are global identity roles. Fine-grained access to a
 * specific case is layered ON TOP of these via case-level membership
 * (see CaseRole + the permission matrix), so holding a global role never
 * implies access to a particular case's confidential material by itself.
 */
export enum Role {
  INDIVIDUAL = 'INDIVIDUAL',
  COMPANY_CLIENT = 'COMPANY_CLIENT',
  LAWYER = 'LAWYER',
  ARBITRATOR = 'ARBITRATOR',
  REGISTRAR = 'REGISTRAR',
  COUNCIL_MEMBER = 'COUNCIL_MEMBER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

export const ALL_ROLES: Role[] = Object.values(Role);

/** Human-readable labels (i18n keys live in the web app; these are fallbacks). */
export const ROLE_LABELS: Record<Role, string> = {
  [Role.INDIVIDUAL]: 'Private Individual',
  [Role.COMPANY_CLIENT]: 'Company Client',
  [Role.LAWYER]: 'Lawyer',
  [Role.ARBITRATOR]: 'Arbitrator',
  [Role.REGISTRAR]: 'Registrar',
  [Role.COUNCIL_MEMBER]: 'Arbitration Council Member',
  [Role.ADMIN]: 'Administrator',
  [Role.SUPER_ADMIN]: 'Super Administrator',
};

/** Staff roles operate the institution; they are NOT parties or tribunal. */
export const STAFF_ROLES: Role[] = [
  Role.REGISTRAR,
  Role.COUNCIL_MEMBER,
  Role.ADMIN,
  Role.SUPER_ADMIN,
];

export const PARTY_ROLES: Role[] = [
  Role.INDIVIDUAL,
  Role.COMPANY_CLIENT,
  Role.LAWYER,
];

/**
 * Per-case relationship of a user to a single case. Confidential tribunal
 * deliberations are gated on TRIBUNAL_* case roles only — never on a global
 * role. Registrars/admins administer the case but cannot read deliberations.
 */
export enum CaseRole {
  CLAIMANT = 'CLAIMANT',
  CLAIMANT_REPRESENTATIVE = 'CLAIMANT_REPRESENTATIVE',
  RESPONDENT = 'RESPONDENT',
  RESPONDENT_REPRESENTATIVE = 'RESPONDENT_REPRESENTATIVE',
  TRIBUNAL_CHAIR = 'TRIBUNAL_CHAIR',
  TRIBUNAL_MEMBER = 'TRIBUNAL_MEMBER',
  TRIBUNAL_SECRETARY = 'TRIBUNAL_SECRETARY',
  CASE_REGISTRAR = 'CASE_REGISTRAR',
  OBSERVER = 'OBSERVER',
}

export const TRIBUNAL_CASE_ROLES: CaseRole[] = [
  CaseRole.TRIBUNAL_CHAIR,
  CaseRole.TRIBUNAL_MEMBER,
];

export const PARTY_CASE_ROLES: CaseRole[] = [
  CaseRole.CLAIMANT,
  CaseRole.CLAIMANT_REPRESENTATIVE,
  CaseRole.RESPONDENT,
  CaseRole.RESPONDENT_REPRESENTATIVE,
];

export enum PartySide {
  CLAIMANT = 'CLAIMANT',
  RESPONDENT = 'RESPONDENT',
}
