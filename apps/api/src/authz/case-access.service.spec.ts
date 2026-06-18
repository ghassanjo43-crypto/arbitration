import { ForbiddenException } from '@nestjs/common';
import { CaseRole, ConfidentialityLevel, PartySide, Permission, Role } from '@gaap/shared';
import { CaseAccessService } from './case-access.service';
import { AuthUser } from '../auth/types';

/**
 * These tests lock down the confidentiality guarantees the spec demands:
 *  - Tribunal deliberations are tribunal-only, even for super-admins.
 *  - The opposing party cannot read PARTY_PRIVATE documents.
 *  - Registrars/admins administer but do not read merits-private content.
 */
function makeService(teamRows: { caseRole: CaseRole; side?: PartySide }[]) {
  const prisma = {
    case: { findUnique: jest.fn().mockResolvedValue({ id: 'case-1' }) },
    caseTeamMember: {
      findMany: jest.fn().mockResolvedValue(teamRows.map((r) => ({ ...r, side: r.side ?? null, active: true }))),
    },
  };
  return new CaseAccessService(prisma as never);
}

const user = (roles: Role[], permissions: Permission[] = []): AuthUser => ({
  id: 'u1',
  email: 'u@example.test',
  roles,
  permissions,
});

describe('CaseAccessService — deliberations', () => {
  it('allows an appointed tribunal chair', async () => {
    const svc = makeService([{ caseRole: CaseRole.TRIBUNAL_CHAIR }]);
    await expect(svc.assertDeliberationAccess(user([Role.ARBITRATOR]), 'case-1')).resolves.toBeUndefined();
  });

  it('denies a super administrator who is not on the tribunal', async () => {
    const svc = makeService([]);
    await expect(
      svc.assertDeliberationAccess(user([Role.SUPER_ADMIN], [Permission.SETTINGS_MANAGE]), 'case-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies a registrar administering the case', async () => {
    const svc = makeService([{ caseRole: CaseRole.CASE_REGISTRAR }]);
    await expect(
      svc.assertDeliberationAccess(user([Role.REGISTRAR], [Permission.CASE_VIEW_QUEUE]), 'case-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('CaseAccessService — document visibility', () => {
  it('blocks the opposing party from PARTY_PRIVATE documents', async () => {
    const svc = makeService([{ caseRole: CaseRole.RESPONDENT, side: PartySide.RESPONDENT }]);
    const canView = await svc.canViewDocument(user([Role.COMPANY_CLIENT]), {
      caseId: 'case-1',
      confidentiality: ConfidentialityLevel.PARTY_PRIVATE,
      visibleToSide: PartySide.CLAIMANT,
    });
    expect(canView).toBe(false);
  });

  it('allows the owning side to view its own PARTY_PRIVATE documents', async () => {
    const svc = makeService([{ caseRole: CaseRole.CLAIMANT, side: PartySide.CLAIMANT }]);
    const canView = await svc.canViewDocument(user([Role.COMPANY_CLIENT]), {
      caseId: 'case-1',
      confidentiality: ConfidentialityLevel.PARTY_PRIVATE,
      visibleToSide: PartySide.CLAIMANT,
    });
    expect(canView).toBe(true);
  });

  it('keeps TRIBUNAL_ONLY documents away from registrars', async () => {
    const svc = makeService([{ caseRole: CaseRole.CASE_REGISTRAR }]);
    const canView = await svc.canViewDocument(user([Role.REGISTRAR], [Permission.CASE_VIEW_QUEUE]), {
      caseId: 'case-1',
      confidentiality: ConfidentialityLevel.TRIBUNAL_ONLY,
      visibleToSide: null,
    });
    expect(canView).toBe(false);
  });
});
