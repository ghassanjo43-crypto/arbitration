import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExpeditedBasis, ExpeditedStatus } from '@prisma/client';
import { Permission } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { AuthUser } from '../auth/types';
import { ExpeditedConsentDto, ProposeExpeditedDto, TerminateExpeditedDto } from './dto';

/**
 * Expedited procedure (Chapter 23).
 *
 * The expedited track is OPTIONAL and never automatic: it requires party
 * agreement (or another legally valid basis) and an explicit, authorised
 * activation. Activation on a PARTY_AGREEMENT basis is blocked if any party has
 * declined or none has consented.
 */
@Injectable()
export class ExpeditedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
  ) {}

  async propose(user: AuthUser, caseId: string, dto: ProposeExpeditedDto) {
    const m = await this.access.assertCanAccessCase(user, caseId);
    if (!m.isParty && !m.isRegistrar && !m.isTribunal) {
      throw new ForbiddenException('Only a party, the registry or the tribunal may propose the expedited track.');
    }
    const existing = await this.prisma.expeditedTrack.findUnique({ where: { caseId } });
    if (existing) throw new BadRequestException('This case already has an expedited track record.');

    const track = await this.prisma.expeditedTrack.create({
      data: {
        caseId,
        basis: dto.basis,
        soleArbitrator: dto.soleArbitrator ?? true,
        documentsOnly: dto.documentsOnly ?? false,
        pageLimit: dto.pageLimit,
        awardTargetDays: dto.awardTargetDays,
        deadlineScalePercent: dto.deadlineScalePercent ?? 50,
        simplifiedFeeSchedule: dto.simplifiedFeeSchedule ?? true,
        proposedById: user.id,
      },
    });
    await this.audit.record({ userId: user.id, action: 'EXPEDITED_PROPOSED', entityType: 'ExpeditedTrack', entityId: track.id, caseId, metadata: { basis: dto.basis } });
    return track;
  }

  private async load(caseId: string) {
    const track = await this.prisma.expeditedTrack.findUnique({ where: { caseId } });
    if (!track) throw new NotFoundException('No expedited track on this case.');
    return track;
  }

  /** A party records its agreement (or refusal) to the expedited track. */
  async consent(user: AuthUser, caseId: string, dto: ExpeditedConsentDto) {
    const track = await this.load(caseId);
    const m = await this.access.assertCanAccessCase(user, caseId);
    if (!m.isParty) throw new ForbiddenException('Only a party may agree to the expedited track.');
    const consent = await this.prisma.expeditedConsent.upsert({
      where: { trackId_userId: { trackId: track.id, userId: user.id } },
      update: { consented: dto.consented, partyId: dto.partyId, note: dto.note },
      create: { trackId: track.id, userId: user.id, consented: dto.consented, partyId: dto.partyId, note: dto.note },
    });
    // Reflect agreement/decline at the track level (still requires activation).
    const consents = await this.prisma.expeditedConsent.findMany({ where: { trackId: track.id } });
    const anyDeclined = consents.some((c) => !c.consented);
    const allConsented = consents.length > 0 && consents.every((c) => c.consented);
    const status = anyDeclined ? ExpeditedStatus.DECLINED : allConsented ? ExpeditedStatus.AGREED : track.status;
    if (status !== track.status) {
      await this.prisma.expeditedTrack.update({ where: { id: track.id }, data: { status } });
    }
    await this.audit.record({ userId: user.id, action: 'EXPEDITED_CONSENT', entityType: 'ExpeditedTrack', entityId: track.id, caseId, metadata: { consented: dto.consented } });
    return consent;
  }

  /**
   * Activate the expedited track. Authorised (registry/tribunal) and deliberate.
   * On a PARTY_AGREEMENT basis, activation is blocked unless at least one party
   * consented and none declined — the track is never applied automatically.
   */
  async activate(user: AuthUser, caseId: string) {
    const track = await this.load(caseId);
    const m = await this.access.assertCanAccessCase(user, caseId);
    if (!m.isRegistrar && !m.isTribunal && !user.permissions.includes(Permission.CASE_REGISTER)) {
      throw new ForbiddenException('Only the registry or the tribunal may activate the expedited track.');
    }
    if (track.status === ExpeditedStatus.ACTIVE) throw new BadRequestException('The expedited track is already active.');

    if (track.basis === ExpeditedBasis.PARTY_AGREEMENT) {
      const consents = await this.prisma.expeditedConsent.findMany({ where: { trackId: track.id } });
      const anyDeclined = consents.some((c) => !c.consented);
      const anyConsented = consents.some((c) => c.consented);
      if (anyDeclined || !anyConsented) {
        throw new BadRequestException('Cannot activate on a party-agreement basis without the parties\' agreement.');
      }
    }

    const updated = await this.prisma.expeditedTrack.update({
      where: { id: track.id },
      data: { status: ExpeditedStatus.ACTIVE, activatedById: user.id, activatedAt: new Date() },
    });
    await this.audit.record({ userId: user.id, action: 'EXPEDITED_ACTIVATED', entityType: 'ExpeditedTrack', entityId: track.id, caseId, metadata: { basis: track.basis } });
    return updated;
  }

  /** Terminate the expedited track and revert to the standard procedure. */
  async terminate(user: AuthUser, caseId: string, dto: TerminateExpeditedDto) {
    const track = await this.load(caseId);
    const m = await this.access.assertCanAccessCase(user, caseId);
    if (!m.isRegistrar && !m.isTribunal) throw new ForbiddenException('Only the registry or the tribunal may terminate the expedited track.');
    const updated = await this.prisma.expeditedTrack.update({
      where: { id: track.id },
      data: { status: ExpeditedStatus.TERMINATED, terminatedReason: dto.reason },
    });
    await this.audit.record({ userId: user.id, action: 'EXPEDITED_TERMINATED', entityType: 'ExpeditedTrack', entityId: track.id, caseId });
    return updated;
  }

  async get(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    return this.prisma.expeditedTrack.findUnique({ where: { caseId }, include: { consents: true } });
  }
}
