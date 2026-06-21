import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CorrectionApproval, FilingStatus } from '@prisma/client';
import { Permission } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { RuleEngineService } from '../rules/rule-engine.service';
import { AuthUser } from '../auth/types';
import { DecideCorrectionDto, RequestCorrectionDto, SubmitFilingDto } from './dto';

/**
 * Pleadings & filings (Chapter 10).
 *
 * Principle enforced here: a filed document is NEVER silently replaced. A
 * correction does not edit the filing — it creates a new, superseding version
 * with full reason/approval provenance, and the original is retained.
 */
@Injectable()
export class FilingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
    private readonly engine: RuleEngineService,
  ) {}

  /** Submit a filing. Parties/representatives file; the registry may also file. */
  async submit(user: AuthUser, caseId: string, dto: SubmitFilingDto) {
    const m = await this.access.assertCanAccessCase(user, caseId);
    if (!m.isParty && !m.isRegistrar && !user.permissions.includes(Permission.CASE_REGISTER)) {
      throw new ForbiddenException('Only a party, its representative or the registry may submit a filing.');
    }

    const count = await this.prisma.filing.count({ where: { caseId } });
    const filingNumber = `F-${String(count + 1).padStart(4, '0')}`;
    const submittedAt = new Date();
    const documentIds = dto.documentIds ?? [];
    const contentHash =
      dto.contentHash ??
      createHash('sha256').update(JSON.stringify({ filingNumber, type: dto.type, title: dto.title, documentIds })).digest('hex');

    const filing = await this.prisma.filing.create({
      data: {
        caseId,
        filingNumber,
        type: dto.type,
        title: dto.title,
        partyId: dto.partyId,
        representativeUserId: dto.representativeUserId,
        submittedById: user.id,
        submittedAt,
        officialTimezone: dto.officialTimezone ?? 'UTC',
        contentHash,
        confidentiality: dto.confidentiality,
        status: FilingStatus.SUBMITTED,
        documents: { create: documentIds.map((documentId) => ({ documentId })) },
      },
    });

    await this.issueReceipt(filing.id);
    await this.audit.record({ userId: user.id, action: 'FILING_SUBMITTED', entityType: 'Filing', entityId: filing.id, caseId, metadata: { filingNumber, type: dto.type, contentHash } });

    // A filing is a procedural event: let the engine react (e.g. start the next
    // pleading's deadline) within the case's pinned rule version.
    const event = await this.prisma.caseProceduralEvent.create({
      data: { caseId, type: 'FILING_SUBMITTED', actorUserId: user.id, metadata: JSON.stringify({ filingType: dto.type, filingNumber }) },
    });
    await this.engine.applyEvent({ caseId, eventId: event.id, eventType: 'FILING_SUBMITTED', actorUserId: user.id });

    return this.get(user, filing.id);
  }

  /** Generate the immutable filing receipt (idempotent: one per filing). */
  private async issueReceipt(filingId: string) {
    const existing = await this.prisma.filingReceipt.findUnique({ where: { filingId } });
    if (existing) return existing;
    const filing = await this.prisma.filing.findUniqueOrThrow({
      where: { id: filingId },
      include: { documents: true, case: { select: { reference: true } } },
    });
    const payloadObj = {
      caseReference: filing.case.reference,
      filingNumber: filing.filingNumber,
      type: filing.type,
      version: filing.version,
      submittedById: filing.submittedById,
      submittedAt: filing.submittedAt,
      officialTimezone: filing.officialTimezone,
      contentHash: filing.contentHash,
      documentCount: filing.documents.length,
    };
    const payload = JSON.stringify(payloadObj);
    const payloadHash = createHash('sha256').update(payload).digest('hex');
    return this.prisma.filingReceipt.create({
      data: { filingId, receiptNumber: `FR-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`, payload, payloadHash },
    });
  }

  async listForCase(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    return this.prisma.filing.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
      include: { documents: true, receipt: true, corrections: true },
    });
  }

  async get(user: AuthUser, filingId: string) {
    const filing = await this.prisma.filing.findUnique({
      where: { id: filingId },
      include: { documents: true, receipt: true, corrections: true, supersedes: { select: { id: true, filingNumber: true, version: true } } },
    });
    if (!filing) throw new NotFoundException('Filing not found.');
    await this.access.assertCanAccessCase(user, filing.caseId);
    return filing;
  }

  /**
   * A party requests a correction to a filed document. This does NOT alter the
   * filing; it records a PENDING correction for the registry/tribunal to decide.
   */
  async requestCorrection(user: AuthUser, filingId: string, dto: RequestCorrectionDto) {
    const filing = await this.prisma.filing.findUnique({ where: { id: filingId } });
    if (!filing) throw new NotFoundException('Filing not found.');
    const m = await this.access.assertCanAccessCase(user, filing.caseId);
    if (!m.isParty && !m.isRegistrar) {
      throw new ForbiddenException('Only a party or the registry may request a correction.');
    }
    if (filing.status === FilingStatus.SUPERSEDED) {
      throw new BadRequestException('This filing version has already been superseded.');
    }

    const correction = await this.prisma.filingCorrection.create({
      data: {
        filingId,
        reason: dto.reason,
        requestedById: user.id,
        previousVersion: filing.version,
        newVersion: filing.version + 1,
      },
    });
    await this.audit.record({ userId: user.id, action: 'FILING_CORRECTION_REQUESTED', entityType: 'FilingCorrection', entityId: correction.id, caseId: filing.caseId, metadata: { filingId, reason: dto.reason } });
    return correction;
  }

  /**
   * The registry/tribunal decides a correction request. On approval a NEW filing
   * version is created that supersedes the original; the original is retained
   * and marked SUPERSEDED. Nothing is overwritten.
   */
  async decideCorrection(user: AuthUser, correctionId: string, dto: DecideCorrectionDto) {
    const correction = await this.prisma.filingCorrection.findUnique({
      where: { id: correctionId },
      include: { filing: { include: { documents: true } } },
    });
    if (!correction) throw new NotFoundException('Correction request not found.');
    const filing = correction.filing;
    const m = await this.access.assertCanAccessCase(user, filing.caseId);
    if (!m.isTribunal && !m.isRegistrar && !user.permissions.includes(Permission.CASE_REGISTER)) {
      throw new ForbiddenException('Only the registry or the tribunal may decide a correction.');
    }
    if (correction.approval !== CorrectionApproval.PENDING) {
      throw new BadRequestException('This correction has already been decided.');
    }

    if (!dto.approve) {
      const rejected = await this.prisma.filingCorrection.update({
        where: { id: correctionId },
        data: { approval: CorrectionApproval.REJECTED, approvedById: user.id },
      });
      await this.audit.record({ userId: user.id, action: 'FILING_CORRECTION_REJECTED', entityType: 'FilingCorrection', entityId: correctionId, caseId: filing.caseId });
      return rejected;
    }

    const documentIds = dto.documentIds ?? filing.documents.map((d) => d.documentId);
    const contentHash =
      dto.contentHash ??
      createHash('sha256').update(JSON.stringify({ base: filing.filingNumber, v: correction.newVersion, documentIds })).digest('hex');

    // Create the superseding version, link it to the original, retire the old.
    const newFiling = await this.prisma.filing.create({
      data: {
        caseId: filing.caseId,
        filingNumber: `${filing.filingNumber}-v${correction.newVersion}`,
        type: filing.type,
        title: filing.title,
        partyId: filing.partyId,
        representativeUserId: filing.representativeUserId,
        submittedById: user.id,
        submittedAt: new Date(),
        officialTimezone: filing.officialTimezone,
        version: correction.newVersion,
        contentHash,
        confidentiality: filing.confidentiality,
        status: FilingStatus.SUBMITTED,
        supersedesId: filing.id,
        documents: { create: documentIds.map((documentId) => ({ documentId })) },
      },
    });
    await this.prisma.filing.update({ where: { id: filing.id }, data: { status: FilingStatus.SUPERSEDED } });
    const decided = await this.prisma.filingCorrection.update({
      where: { id: correctionId },
      data: { approval: CorrectionApproval.APPROVED, approvedById: user.id, newFilingId: newFiling.id },
    });
    await this.issueReceipt(newFiling.id);
    await this.audit.record({ userId: user.id, action: 'FILING_CORRECTION_APPROVED', entityType: 'Filing', entityId: newFiling.id, caseId: filing.caseId, metadata: { supersedes: filing.id, newVersion: correction.newVersion } });
    return { correction: decided, newFiling };
  }
}
