import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CaseRole,
  ConfidentialityLevel,
  PartySide,
  Permission,
  Role,
  TRIBUNAL_CASE_ROLES,
} from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/types';

export interface CaseMembership {
  caseRoles: CaseRole[];
  sides: PartySide[];
  isTribunal: boolean;
  isParty: boolean;
  isRegistrar: boolean;
  /**
   * Administrative reach: the user holds an institutional administrative role
   * (registrar/admin via CASE_VIEW_QUEUE, or super-admin) and may administer this
   * case even without being a case-team member. This is what authorises the
   * registrar case-administration surface — never deliberations or merits.
   */
  canAdminister: boolean;
}

/**
 * Central case-level authorization. The rules the spec demands:
 *  - A user only sees cases/documents they are authorised for.
 *  - Tribunal deliberations are tribunal-only, even for admins/registrars/
 *    council/super-admins — UNLESS they are an appointed tribunal member.
 *  - Registrars/admins administer but do not read deliberations or freely
 *    browse confidential merits.
 *  - Claimant cannot read respondent PARTY_PRIVATE docs and vice versa.
 */
@Injectable()
export class CaseAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async getMembership(user: AuthUser, caseId: string): Promise<CaseMembership> {
    const rows = await this.prisma.caseTeamMember.findMany({
      where: { caseId, userId: user.id, active: true },
    });
    // Prisma generates its own nominal enums; cast to the shared enums at this boundary.
    const caseRoles = rows.map((r) => r.caseRole as CaseRole);
    const sides = rows
      .map((r) => r.side as PartySide | null)
      .filter((s): s is PartySide => s !== null && s !== undefined);
    const isTribunal = caseRoles.some((r) => TRIBUNAL_CASE_ROLES.includes(r));
    const isParty = caseRoles.some((r) =>
      [
        CaseRole.CLAIMANT,
        CaseRole.CLAIMANT_REPRESENTATIVE,
        CaseRole.RESPONDENT,
        CaseRole.RESPONDENT_REPRESENTATIVE,
      ].includes(r),
    );
    const isRegistrar = caseRoles.includes(CaseRole.CASE_REGISTRAR);
    const canAdminister = this.hasAdministrativeReach(user);
    return { caseRoles, sides, isTribunal, isParty, isRegistrar, canAdminister };
  }

  /** Any authorised connection to the case (membership OR administrative role). */
  async assertCanAccessCase(user: AuthUser, caseId: string): Promise<CaseMembership> {
    const exists = await this.prisma.case.findUnique({ where: { id: caseId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Case not found.');

    const membership = await this.getMembership(user, caseId);
    if (membership.caseRoles.length === 0 && !membership.canAdminister) {
      throw new ForbiddenException('You are not authorised to access this case.');
    }
    return membership;
  }

  /** Registrars/admins can administer a case but cannot read deliberations/merits-private. */
  private hasAdministrativeReach(user: AuthUser): boolean {
    return user.permissions.includes(Permission.CASE_VIEW_QUEUE) || user.roles.includes(Role.SUPER_ADMIN);
  }

  /**
   * Deliberation access: ONLY appointed tribunal members on THIS case.
   * No global role — not super-admin, not registrar, not council — bypasses this.
   */
  async assertDeliberationAccess(user: AuthUser, caseId: string): Promise<void> {
    const membership = await this.getMembership(user, caseId);
    if (!membership.isTribunal) {
      throw new ForbiddenException(
        'Tribunal deliberations are restricted to appointed tribunal members of this case.',
      );
    }
  }

  /**
   * Document visibility decision. Returns true if the user may view the doc.
   * Download is a separate, stricter capability resolved by the document service.
   */
  async canViewDocument(
    user: AuthUser,
    doc: { caseId: string; confidentiality: ConfidentialityLevel | string; visibleToSide: PartySide | string | null },
  ): Promise<boolean> {
    const level = doc.confidentiality as ConfidentialityLevel;
    if (level === ConfidentialityLevel.PUBLIC) return true;

    const membership = await this.getMembership(user, doc.caseId);
    const isStaffAdmin = this.hasAdministrativeReach(user);

    switch (level) {
      case ConfidentialityLevel.CASE_PARTIES:
        // All authorised case participants + administering staff.
        return membership.caseRoles.length > 0 || membership.isTribunal || isStaffAdmin;

      case ConfidentialityLevel.PARTY_PRIVATE: {
        // Only the owning side (and that side's reps) + the tribunal. NOT the
        // opposing party. Registrar/admin do NOT get merits-private content.
        if (membership.isTribunal) return true;
        if (!doc.visibleToSide) return membership.isParty;
        return membership.sides.includes(doc.visibleToSide as PartySide);
      }

      case ConfidentialityLevel.TRIBUNAL_ONLY:
        return membership.isTribunal;

      case ConfidentialityLevel.ADMIN_ONLY:
        // Institutional administrative documents (not merits). Staff with reach.
        return isStaffAdmin || membership.isRegistrar;

      default:
        return false;
    }
  }
}
