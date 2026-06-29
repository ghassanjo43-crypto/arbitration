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
  [Role.INDIVIDUAL]: 'Individual',
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
 * Filing a new arbitration case is a PARTY act. It is available only to a person
 * or company acting as a party (Individual, Company) or to an authorized
 * representative (Lawyer) filing on their behalf. Tribunal and institutional
 * roles — Arbitrator, Registrar, Council member, Admin, Super Admin — must NEVER
 * be able to initiate a case from those accounts (role separation / conflict
 * prevention). Holding a staff/tribunal role alongside a party role does not
 * remove the party capacity, but it should trigger a conflict warning in the UI.
 */
export function canFileCase(roles: Role[]): boolean {
  return roles.some((r) => PARTY_ROLES.includes(r));
}

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

/**
 * Legal IDENTITY of an account, derived from its global roles. This is distinct
 * from a per-case role (Claimant/Respondent), which depends on case membership.
 * The platform classifies users by identity + case role — never as a generic
 * "private individual".
 */
export enum IdentityType {
  INDIVIDUAL = 'INDIVIDUAL',
  COMPANY = 'COMPANY',
  LAW_FIRM = 'LAW_FIRM',
  ARBITRATOR = 'ARBITRATOR',
  INTERNAL = 'INTERNAL',
}

export const IDENTITY_TYPE_LABELS: Record<IdentityType, string> = {
  [IdentityType.INDIVIDUAL]: 'Individual',
  [IdentityType.COMPANY]: 'Company / Organization',
  [IdentityType.LAW_FIRM]: 'Law firm / Representative',
  [IdentityType.ARBITRATOR]: 'Arbitrator',
  [IdentityType.INTERNAL]: 'Internal platform user',
};

/** External identity types a Super Admin may assign (Internal is derived from system roles). */
export const ASSIGNABLE_IDENTITY_TYPES: IdentityType[] = [
  IdentityType.INDIVIDUAL,
  IdentityType.COMPANY,
  IdentityType.LAW_FIRM,
  IdentityType.ARBITRATOR,
];

/** Global roles that denote an account's external legal identity (not internal staff). */
export const IDENTITY_ROLES: Role[] = [Role.INDIVIDUAL, Role.COMPANY_CLIENT, Role.LAWYER, Role.ARBITRATOR];

const INTERNAL_ROLES: Role[] = [Role.REGISTRAR, Role.COUNCIL_MEMBER, Role.ADMIN, Role.SUPER_ADMIN];

/** Derive the legal-identity classification from a user's global roles. */
export function identityForRoles(roles: Role[]): IdentityType {
  if (roles.some((r) => INTERNAL_ROLES.includes(r))) return IdentityType.INTERNAL;
  if (roles.includes(Role.ARBITRATOR)) return IdentityType.ARBITRATOR;
  if (roles.includes(Role.LAWYER)) return IdentityType.LAW_FIRM;
  if (roles.includes(Role.COMPANY_CLIENT)) return IdentityType.COMPANY;
  return IdentityType.INDIVIDUAL;
}

/** The global role that represents each assignable identity type. */
export const IDENTITY_TYPE_ROLE: Record<Exclude<IdentityType, IdentityType.INTERNAL>, Role> = {
  [IdentityType.INDIVIDUAL]: Role.INDIVIDUAL,
  [IdentityType.COMPANY]: Role.COMPANY_CLIENT,
  [IdentityType.LAW_FIRM]: Role.LAWYER,
  [IdentityType.ARBITRATOR]: Role.ARBITRATOR,
};

/** Human-readable labels for per-case roles. */
export const CASE_ROLE_LABELS: Record<CaseRole, string> = {
  [CaseRole.CLAIMANT]: 'Claimant',
  [CaseRole.CLAIMANT_REPRESENTATIVE]: 'Claimant Representative',
  [CaseRole.RESPONDENT]: 'Respondent',
  [CaseRole.RESPONDENT_REPRESENTATIVE]: 'Respondent Representative',
  [CaseRole.TRIBUNAL_CHAIR]: 'Tribunal Chair',
  [CaseRole.TRIBUNAL_MEMBER]: 'Arbitrator / Tribunal',
  [CaseRole.TRIBUNAL_SECRETARY]: 'Tribunal Secretary',
  [CaseRole.CASE_REGISTRAR]: 'Registrar',
  [CaseRole.OBSERVER]: 'Observer',
};
