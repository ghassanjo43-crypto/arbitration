import { ALL_ROLES, Permission, permissionsForRoles, Role, ROLE_PERMISSIONS, STAFF_ROLES } from '@gaap/shared';

describe('Role/permission matrix invariants', () => {
  it('never grants deliberation:participate to ANY global role', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.DELIBERATION_PARTICIPATE);
    }
  });

  it('gives party roles no global permissions', () => {
    for (const role of [Role.INDIVIDUAL, Role.COMPANY_CLIENT, Role.LAWYER, Role.ARBITRATOR]) {
      expect(ROLE_PERMISSIONS[role]).toHaveLength(0);
    }
  });

  it('restricts role:manage and settings:manage to the super administrator', () => {
    for (const role of ALL_ROLES) {
      const held = ROLE_PERMISSIONS[role];
      if (role === Role.SUPER_ADMIN) {
        expect(held).toContain(Permission.ROLE_MANAGE);
        expect(held).toContain(Permission.SETTINGS_MANAGE);
      } else {
        expect(held).not.toContain(Permission.ROLE_MANAGE);
        expect(held).not.toContain(Permission.SETTINGS_MANAGE);
      }
    }
  });

  it('lets the registrar run the case queue but not approve arbitrators', () => {
    const reg = ROLE_PERMISSIONS[Role.REGISTRAR];
    expect(reg).toContain(Permission.CASE_VIEW_QUEUE);
    expect(reg).not.toContain(Permission.ARBITRATOR_APPROVE);
  });

  it('reserves arbitrator approval/challenges for the council', () => {
    expect(ROLE_PERMISSIONS[Role.COUNCIL_MEMBER]).toContain(Permission.ARBITRATOR_APPROVE);
    expect(ROLE_PERMISSIONS[Role.COUNCIL_MEMBER]).toContain(Permission.CHALLENGE_DECIDE);
  });

  it('merges permissions across multiple roles without duplicates', () => {
    const merged = permissionsForRoles([Role.REGISTRAR, Role.ADMIN]);
    expect(new Set(merged).size).toBe(merged.length);
    expect(merged).toContain(Permission.CASE_VIEW_QUEUE);
    expect(merged).toContain(Permission.USER_MANAGE);
  });

  it('classifies all institutional roles as staff', () => {
    expect(STAFF_ROLES).toEqual(expect.arrayContaining([Role.REGISTRAR, Role.COUNCIL_MEMBER, Role.ADMIN, Role.SUPER_ADMIN]));
  });

  // ---- User-administration boundary (platform admin must not be case/tribunal power) ----

  it('restricts user:manage to ADMIN and SUPER_ADMIN only', () => {
    for (const role of ALL_ROLES) {
      const held = ROLE_PERMISSIONS[role];
      if (role === Role.ADMIN || role === Role.SUPER_ADMIN) {
        expect(held).toContain(Permission.USER_MANAGE);
      } else {
        expect(held).not.toContain(Permission.USER_MANAGE);
      }
    }
  });

  it('keeps the super administrator out of tribunal confidentiality and award powers', () => {
    // Platform user-administration must never imply deliberation/merits access.
    const su = ROLE_PERMISSIONS[Role.SUPER_ADMIN];
    expect(su).not.toContain(Permission.DELIBERATION_PARTICIPATE);
    // Super admin holds NO case-merits institutional powers (those are the registrar's,
    // and tribunal/award authority is only ever granted via case membership).
    expect(su).not.toContain(Permission.CASE_REGISTER);
    expect(su).not.toContain(Permission.CASE_MANAGE_SERVICE);
  });

  // ---- Registrar boundary: administers the arbitration, never decides it ----

  it('gives the registrar the operational case-administration permissions', () => {
    const reg = ROLE_PERMISSIONS[Role.REGISTRAR];
    for (const p of [
      Permission.CASE_VIEW_QUEUE,
      Permission.CASE_REGISTER,
      Permission.CASE_ISSUE_DEFICIENCY,
      Permission.CASE_MANAGE_SERVICE,
      Permission.CASE_MANAGE_DEADLINES,
      Permission.CASE_SCHEDULE_HEARING,
      Permission.APPOINTMENT_MANAGE,
      Permission.CONFLICT_REVIEW,
    ]) {
      expect(reg).toContain(p);
    }
  });

  it('never lets the registrar decide merits, read deliberations, or administer the platform', () => {
    const reg = ROLE_PERMISSIONS[Role.REGISTRAR];
    // Deciding arbitrator challenges belongs to the Council, not the registrar.
    expect(reg).not.toContain(Permission.CHALLENGE_DECIDE);
    // Deliberation is never a global permission for anyone.
    expect(reg).not.toContain(Permission.DELIBERATION_PARTICIPATE);
    // No platform/governance powers.
    expect(reg).not.toContain(Permission.SETTINGS_MANAGE);
    expect(reg).not.toContain(Permission.USER_MANAGE);
    expect(reg).not.toContain(Permission.ROLE_MANAGE);
    expect(reg).not.toContain(Permission.POLICY_MANAGE);
    expect(reg).not.toContain(Permission.AUDIT_VIEW);
  });
});
