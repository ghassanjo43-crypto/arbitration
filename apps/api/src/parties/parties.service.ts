import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseRole, PartySide } from '@prisma/client';
import { Permission } from '@gaap/shared';
import { ScreeningSubjectType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { ComplianceService } from '../compliance/compliance.service';
import { AuthUser } from '../auth/types';
import { AddRepresentativeDto, AddTeamMemberDto, UpsertPartyDto } from './dto';

const PARTY_REP_ROLES: CaseRole[] = [CaseRole.CLAIMANT_REPRESENTATIVE, CaseRole.RESPONDENT_REPRESENTATIVE];

@Injectable()
export class PartiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
    private readonly compliance: ComplianceService,
  ) {}

  /** A party or that side's representative (or administering staff) may edit a side's details. */
  private async assertCanManageSide(user: AuthUser, caseId: string, side: string) {
    const m = await this.access.assertCanAccessCase(user, caseId);
    const isStaff = m.isRegistrar || user.permissions.includes(Permission.CASE_VIEW_QUEUE);
    const ownsSide = (m.sides as unknown as string[]).includes(side) && !m.isTribunal;
    if (!ownsSide && !isStaff) {
      throw new ForbiddenException('You may only manage your own side of the case.');
    }
  }

  async addParty(user: AuthUser, caseId: string, dto: UpsertPartyDto) {
    await this.assertCanManageSide(user, caseId, dto.side);
    const party = await this.prisma.caseParty.create({ data: { caseId, ...dto } });
    await this.audit.record({ userId: user.id, action: 'PARTY_ADDED', entityType: 'CaseParty', entityId: party.id, caseId });
    // Screen the new party (best-effort; a match raises a compliance hold).
    await this.compliance.rescreenForEvent({
      event: 'PARTY_ADDED',
      caseId,
      requestedById: user.id,
      subjects: [{ subjectType: ScreeningSubjectType.PARTY, subjectId: party.id, subjectName: party.legalName, caseId, country: party.country ?? party.nationality ?? undefined }],
    });
    return party;
  }

  async updateParty(user: AuthUser, partyId: string, dto: UpsertPartyDto) {
    const party = await this.prisma.caseParty.findUnique({ where: { id: partyId } });
    if (!party) throw new NotFoundException('Party not found.');
    await this.assertCanManageSide(user, party.caseId, party.side);
    const updated = await this.prisma.caseParty.update({ where: { id: partyId }, data: dto });
    await this.audit.record({ userId: user.id, action: 'PARTY_UPDATED', entityType: 'CaseParty', entityId: partyId, caseId: party.caseId });
    return updated;
  }

  async addRepresentative(user: AuthUser, partyId: string, dto: AddRepresentativeDto) {
    const party = await this.prisma.caseParty.findUnique({ where: { id: partyId } });
    if (!party) throw new NotFoundException('Party not found.');
    await this.assertCanManageSide(user, party.caseId, party.side);

    const rep = await this.prisma.partyRepresentative.create({ data: { partyId, ...dto } });

    // If linked to a user account, also grant them case-team representative access.
    if (dto.lawyerUserId) {
      const caseRole = party.side === PartySide.CLAIMANT ? CaseRole.CLAIMANT_REPRESENTATIVE : CaseRole.RESPONDENT_REPRESENTATIVE;
      await this.prisma.caseTeamMember.upsert({
        where: { caseId_userId_caseRole: { caseId: party.caseId, userId: dto.lawyerUserId, caseRole } },
        update: { active: true },
        create: { caseId: party.caseId, userId: dto.lawyerUserId, caseRole, side: party.side, addedBy: user.id },
      });
    }
    await this.audit.record({ userId: user.id, action: 'REPRESENTATIVE_ADDED', entityType: 'PartyRepresentative', entityId: rep.id, caseId: party.caseId });
    return rep;
  }

  /** Add a colleague to the case team on a given side (legal-team management). */
  async addTeamMember(user: AuthUser, caseId: string, dto: AddTeamMemberDto) {
    if (!PARTY_REP_ROLES.includes(dto.caseRole) && dto.caseRole !== CaseRole.OBSERVER) {
      throw new ForbiddenException('This endpoint only adds representatives or observers.');
    }
    const side: PartySide =
      dto.side ?? (dto.caseRole === CaseRole.CLAIMANT_REPRESENTATIVE ? PartySide.CLAIMANT : PartySide.RESPONDENT);
    await this.assertCanManageSide(user, caseId, side);

    const member = await this.prisma.caseTeamMember.upsert({
      where: { caseId_userId_caseRole: { caseId, userId: dto.userId, caseRole: dto.caseRole } },
      update: { active: true, side },
      create: { caseId, userId: dto.userId, caseRole: dto.caseRole, side, addedBy: user.id },
    });
    await this.audit.record({ userId: user.id, action: 'CASE_TEAM_MEMBER_ADDED', entityType: 'CaseTeamMember', entityId: member.id, caseId, metadata: { role: dto.caseRole } });
    return member;
  }

  async listTeam(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    return this.prisma.caseTeamMember.findMany({
      where: { caseId, active: true },
      include: { user: { select: { id: true, email: true, profile: { select: { displayName: true } } } } },
    });
  }
}
