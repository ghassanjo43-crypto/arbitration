import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InterimEventKind, InterimStatus } from '@prisma/client';
import { Permission } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { AuthUser } from '../auth/types';
import { ApplyInterimDto, DecideInterimDto, InterimDetailDto } from './dto';

const TRIBUNAL_DECISIONS: InterimStatus[] = [
  InterimStatus.GRANTED,
  InterimStatus.GRANTED_IN_PART,
  InterimStatus.DENIED,
];

/**
 * Interim & emergency measures (Chapter 16).
 *
 * The portal records the application, opposition and the tribunal's decision —
 * it NEVER itself grants relief. Only the tribunal may grant, modify or
 * discharge a measure.
 */
@Injectable()
export class InterimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
  ) {}

  private async load(measureId: string) {
    const measure = await this.prisma.interimMeasure.findUnique({ where: { id: measureId } });
    if (!measure) throw new NotFoundException('Interim measure not found.');
    return measure;
  }

  private async event(measureId: string, kind: InterimEventKind, detail: string, actorById: string) {
    return this.prisma.interimMeasureEvent.create({ data: { measureId, kind, detail, actorById } });
  }

  /** A party applies for an interim measure. */
  async apply(user: AuthUser, caseId: string, dto: ApplyInterimDto) {
    const m = await this.access.assertCanAccessCase(user, caseId);
    if (!m.isParty) throw new ForbiddenException('Only a party may apply for an interim measure.');
    const count = await this.prisma.interimMeasure.count({ where: { caseId } });
    const measure = await this.prisma.interimMeasure.create({
      data: {
        caseId,
        measureNumber: `IM-${String(count + 1).padStart(4, '0')}`,
        type: dto.type,
        reliefSought: dto.reliefSought,
        grounds: dto.grounds,
        urgency: dto.urgency,
        applicantPartyId: dto.applicantPartyId,
        appliedById: user.id,
      },
    });
    await this.audit.record({ userId: user.id, action: 'INTERIM_APPLIED', entityType: 'InterimMeasure', entityId: measure.id, caseId, metadata: { type: dto.type, urgency: measure.urgency } });
    return measure;
  }

  /** The other party opposes the application. */
  async oppose(user: AuthUser, measureId: string, dto: InterimDetailDto) {
    const measure = await this.load(measureId);
    const m = await this.access.assertCanAccessCase(user, measure.caseId);
    if (!m.isParty) throw new ForbiddenException('Only a party may oppose an interim measure.');
    await this.event(measureId, InterimEventKind.OPPOSITION, dto.detail, user.id);
    const updated = await this.prisma.interimMeasure.update({ where: { id: measureId }, data: { status: InterimStatus.OPPOSED } });
    await this.audit.record({ userId: user.id, action: 'INTERIM_OPPOSED', entityType: 'InterimMeasure', entityId: measureId, caseId: measure.caseId });
    return updated;
  }

  /** The registry issues notice of the application to the parties. */
  async issueNotice(user: AuthUser, measureId: string, dto: InterimDetailDto) {
    const measure = await this.load(measureId);
    const m = await this.access.assertCanAccessCase(user, measure.caseId);
    if (!m.isRegistrar && !m.isTribunal && !user.permissions.includes(Permission.CASE_MANAGE_SERVICE)) {
      throw new ForbiddenException('Only the registry or the tribunal may issue notice of an interim application.');
    }
    await this.event(measureId, InterimEventKind.NOTICE, dto.detail, user.id);
    return this.load(measureId);
  }

  /**
   * The TRIBUNAL decides the application. The portal never grants relief itself.
   */
  async decide(user: AuthUser, measureId: string, dto: DecideInterimDto) {
    const measure = await this.load(measureId);
    const m = await this.access.assertCanAccessCase(user, measure.caseId);
    if (!m.isTribunal) throw new ForbiddenException('Only the tribunal may decide an interim measure.');
    if (!TRIBUNAL_DECISIONS.includes(dto.decision)) {
      throw new BadRequestException('Decision must be GRANTED, GRANTED_IN_PART or DENIED.');
    }
    if (measure.decidedAt) throw new BadRequestException('This interim measure has already been decided.');

    await this.event(measureId, InterimEventKind.DECISION, `${dto.decision}: ${dto.reason}`, user.id);
    const updated = await this.prisma.interimMeasure.update({
      where: { id: measureId },
      data: { status: dto.decision, decision: dto.decision, decisionReason: dto.reason, decidedById: user.id, decidedAt: new Date() },
    });
    await this.audit.record({ userId: user.id, action: 'INTERIM_DECIDED', entityType: 'InterimMeasure', entityId: measureId, caseId: measure.caseId, metadata: { decision: dto.decision } });
    return updated;
  }

  /** The tribunal modifies a granted measure. */
  async modify(user: AuthUser, measureId: string, dto: InterimDetailDto) {
    const measure = await this.load(measureId);
    const m = await this.access.assertCanAccessCase(user, measure.caseId);
    if (!m.isTribunal) throw new ForbiddenException('Only the tribunal may modify an interim measure.');
    await this.event(measureId, InterimEventKind.MODIFICATION, dto.detail, user.id);
    const updated = await this.prisma.interimMeasure.update({ where: { id: measureId }, data: { status: InterimStatus.MODIFIED } });
    await this.audit.record({ userId: user.id, action: 'INTERIM_MODIFIED', entityType: 'InterimMeasure', entityId: measureId, caseId: measure.caseId });
    return updated;
  }

  /** The tribunal discharges a measure. */
  async discharge(user: AuthUser, measureId: string, dto: InterimDetailDto) {
    const measure = await this.load(measureId);
    const m = await this.access.assertCanAccessCase(user, measure.caseId);
    if (!m.isTribunal) throw new ForbiddenException('Only the tribunal may discharge an interim measure.');
    await this.event(measureId, InterimEventKind.DISCHARGE, dto.detail, user.id);
    const updated = await this.prisma.interimMeasure.update({ where: { id: measureId }, data: { status: InterimStatus.DISCHARGED } });
    await this.audit.record({ userId: user.id, action: 'INTERIM_DISCHARGED', entityType: 'InterimMeasure', entityId: measureId, caseId: measure.caseId });
    return updated;
  }

  /** A party/registrar records compliance with a granted measure. */
  async recordCompliance(user: AuthUser, measureId: string, dto: InterimDetailDto) {
    const measure = await this.load(measureId);
    const mem = await this.access.assertCanAccessCase(user, measure.caseId);
    if (!mem.isParty && !mem.isRegistrar) throw new ForbiddenException('Only a party or the registry may record compliance.');
    const ev = await this.event(measureId, InterimEventKind.COMPLIANCE, dto.detail, user.id);
    await this.audit.record({ userId: user.id, action: 'INTERIM_COMPLIANCE_RECORDED', entityType: 'InterimMeasureEvent', entityId: ev.id, caseId: measure.caseId });
    return ev;
  }

  async get(user: AuthUser, measureId: string) {
    const measure = await this.prisma.interimMeasure.findUnique({
      where: { id: measureId },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!measure) throw new NotFoundException('Interim measure not found.');
    await this.access.assertCanAccessCase(user, measure.caseId);
    return measure;
  }

  async listForCase(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    return this.prisma.interimMeasure.findMany({
      where: { caseId },
      orderBy: { measureNumber: 'asc' },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
  }
}
