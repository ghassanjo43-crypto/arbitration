import { ForbiddenException, Injectable } from '@nestjs/common';
import { CaseRole } from '@prisma/client';
import { Role } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/types';
import { UpsertLawyerProfileDto } from './dto';

@Injectable()
export class LawyersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private ensureLawyer(user: AuthUser) {
    if (!user.roles.includes(Role.LAWYER)) {
      throw new ForbiddenException('Only lawyers may use this resource.');
    }
  }

  async getMyProfile(user: AuthUser) {
    this.ensureLawyer(user);
    return this.prisma.lawyerProfile.findUnique({ where: { userId: user.id }, include: { documents: true } });
  }

  async upsertProfile(user: AuthUser, dto: UpsertLawyerProfileDto) {
    this.ensureLawyer(user);
    const profile = await this.prisma.lawyerProfile.upsert({
      where: { userId: user.id },
      update: { ...dto },
      create: { userId: user.id, fullName: dto.fullName ?? user.email, ...dto },
    });
    await this.audit.record({ userId: user.id, action: 'LAWYER_PROFILE_UPDATED', entityType: 'LawyerProfile', entityId: profile.id });
    return profile;
  }

  /** Lawyer dashboard: cases where the lawyer is a representative, plus derived clients. */
  async dashboard(user: AuthUser) {
    this.ensureLawyer(user);
    const memberships = await this.prisma.caseTeamMember.findMany({
      where: {
        userId: user.id,
        active: true,
        caseRole: { in: [CaseRole.CLAIMANT_REPRESENTATIVE, CaseRole.RESPONDENT_REPRESENTATIVE] },
      },
      include: {
        case: {
          include: {
            parties: { select: { id: true, side: true, legalName: true, linkedUserId: true, linkedCompanyId: true } },
            deadlines: { where: { status: 'OPEN' }, orderBy: { dueAt: 'asc' }, take: 1 },
          },
        },
      },
    });

    const cases = memberships.map((m) => ({
      id: m.caseId,
      reference: m.case.reference,
      title: m.case.title,
      stage: m.case.stage,
      side: m.side,
      nextDeadlineAt: m.case.deadlines[0]?.dueAt ?? null,
    }));

    // Clients = the represented parties on the lawyer's side, de-duplicated by name.
    const clientsMap = new Map<string, { legalName: string; cases: string[] }>();
    for (const m of memberships) {
      for (const p of m.case.parties) {
        if (m.side && p.side !== m.side) continue;
        const key = p.legalName;
        const entry = clientsMap.get(key) ?? { legalName: p.legalName, cases: [] };
        if (!entry.cases.includes(m.case.reference)) entry.cases.push(m.case.reference);
        clientsMap.set(key, entry);
      }
    }

    return {
      activeCases: cases.filter((c) => !['CLOSED', 'SETTLED', 'WITHDRAWN', 'TERMINATED'].includes(c.stage)),
      closedCases: cases.filter((c) => ['CLOSED', 'SETTLED', 'WITHDRAWN', 'TERMINATED'].includes(c.stage)),
      clients: [...clientsMap.values()],
    };
  }
}
