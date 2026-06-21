import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProductionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { AuthUser } from '../auth/types';
import {
  CreateProductionRequestDto,
  DecideProductionDto,
  NonComplianceDto,
  ObjectProductionDto,
  ProduceDocumentsDto,
  ReplyProductionDto,
} from './dto';

const TRIBUNAL_DECISIONS: ProductionStatus[] = [
  ProductionStatus.GRANTED,
  ProductionStatus.GRANTED_IN_PART,
  ProductionStatus.DENIED,
];

/**
 * Document production (Chapter 12) — a Redfern-style request schedule.
 *
 * The portal records the schedule (request → objection → reply → decision →
 * production) but the TRIBUNAL alone decides what must be produced. The portal
 * never grants relief itself.
 */
@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
  ) {}

  private async load(requestId: string) {
    const request = await this.prisma.productionRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Production request not found.');
    return request;
  }

  /** A party requests production of a category of documents. */
  async createRequest(user: AuthUser, caseId: string, dto: CreateProductionRequestDto) {
    const m = await this.access.assertCanAccessCase(user, caseId);
    if (!m.isParty) throw new ForbiddenException('Only a party may request document production.');

    const count = await this.prisma.productionRequest.count({ where: { caseId } });
    const request = await this.prisma.productionRequest.create({
      data: {
        caseId,
        requestNumber: `R-${String(count + 1).padStart(4, '0')}`,
        requestingPartyId: dto.requestingPartyId,
        requestedById: user.id,
        category: dto.category,
        relevance: dto.relevance,
        materiality: dto.materiality,
        status: ProductionStatus.REQUESTED,
      },
    });
    await this.audit.record({ userId: user.id, action: 'PRODUCTION_REQUESTED', entityType: 'ProductionRequest', entityId: request.id, caseId, metadata: { requestNumber: request.requestNumber } });
    return request;
  }

  /** The other party objects (optionally claiming privilege). */
  async object(user: AuthUser, requestId: string, dto: ObjectProductionDto) {
    const request = await this.load(requestId);
    const m = await this.access.assertCanAccessCase(user, request.caseId);
    if (!m.isParty) throw new ForbiddenException('Only a party may object to a production request.');
    const updated = await this.prisma.productionRequest.update({
      where: { id: requestId },
      data: { objection: dto.objection, objectedById: user.id, privilegeClaim: dto.privilegeClaim, status: ProductionStatus.OBJECTED },
    });
    await this.audit.record({ userId: user.id, action: 'PRODUCTION_OBJECTED', entityType: 'ProductionRequest', entityId: requestId, caseId: request.caseId });
    return updated;
  }

  /** The requesting party replies to an objection. */
  async reply(user: AuthUser, requestId: string, dto: ReplyProductionDto) {
    const request = await this.load(requestId);
    const m = await this.access.assertCanAccessCase(user, request.caseId);
    if (!m.isParty) throw new ForbiddenException('Only a party may reply on a production request.');
    const updated = await this.prisma.productionRequest.update({
      where: { id: requestId },
      data: { reply: dto.reply, status: ProductionStatus.REPLIED },
    });
    await this.audit.record({ userId: user.id, action: 'PRODUCTION_REPLIED', entityType: 'ProductionRequest', entityId: requestId, caseId: request.caseId });
    return updated;
  }

  /** The TRIBUNAL decides the request. Only the tribunal may grant/deny. */
  async decide(user: AuthUser, requestId: string, dto: DecideProductionDto) {
    const request = await this.load(requestId);
    const m = await this.access.assertCanAccessCase(user, request.caseId);
    if (!m.isTribunal) {
      throw new ForbiddenException('Only the tribunal may decide a production request.');
    }
    if (!TRIBUNAL_DECISIONS.includes(dto.decision)) {
      throw new BadRequestException('Decision must be GRANTED, GRANTED_IN_PART or DENIED.');
    }
    const updated = await this.prisma.productionRequest.update({
      where: { id: requestId },
      data: {
        status: dto.decision,
        tribunalDecision: dto.decision,
        decisionReason: dto.reason,
        decidedById: user.id,
        confidentialityOrder: dto.confidentialityOrder,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      },
    });
    await this.audit.record({ userId: user.id, action: 'PRODUCTION_DECIDED', entityType: 'ProductionRequest', entityId: requestId, caseId: request.caseId, metadata: { decision: dto.decision } });
    return updated;
  }

  /** The producing party produces documents in response to a granted request. */
  async produce(user: AuthUser, requestId: string, dto: ProduceDocumentsDto) {
    const request = await this.load(requestId);
    const m = await this.access.assertCanAccessCase(user, request.caseId);
    if (!m.isParty) throw new ForbiddenException('Only a party may produce documents.');
    if (request.status !== ProductionStatus.GRANTED && request.status !== ProductionStatus.GRANTED_IN_PART) {
      throw new BadRequestException('Documents may only be produced after the tribunal grants the request.');
    }
    await this.prisma.productionDocument.createMany({
      data: dto.documentIds.map((documentId) => ({ requestId, documentId })),
      skipDuplicates: true,
    });
    const updated = await this.prisma.productionRequest.update({
      where: { id: requestId },
      data: { status: ProductionStatus.PRODUCED, producedAt: new Date() },
    });
    await this.audit.record({ userId: user.id, action: 'PRODUCTION_PRODUCED', entityType: 'ProductionRequest', entityId: requestId, caseId: request.caseId, metadata: { count: dto.documentIds.length } });
    return updated;
  }

  /** Record non-compliance with a production order (for a tribunal application). */
  async flagNonCompliance(user: AuthUser, requestId: string, dto: NonComplianceDto) {
    const request = await this.load(requestId);
    const m = await this.access.assertCanAccessCase(user, request.caseId);
    if (!m.isParty && !m.isRegistrar) throw new ForbiddenException('Only a party or the registry may flag non-compliance.');
    const updated = await this.prisma.productionRequest.update({
      where: { id: requestId },
      data: { status: ProductionStatus.NON_COMPLIANCE, decisionReason: dto.note },
    });
    await this.audit.record({ userId: user.id, action: 'PRODUCTION_NON_COMPLIANCE', entityType: 'ProductionRequest', entityId: requestId, caseId: request.caseId });
    return updated;
  }

  /** The full Redfern-style schedule for a case. */
  async listSchedule(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    return this.prisma.productionRequest.findMany({
      where: { caseId },
      orderBy: { requestNumber: 'asc' },
      include: { documents: true },
    });
  }
}
