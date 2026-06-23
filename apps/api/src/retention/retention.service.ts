import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { CaseStage, LegalHoldStatus, RetentionStatus } from '@prisma/client';
import { Permission, Role } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/types';
import { ExecuteSweepDto, PlaceLegalHoldDto, ReleaseLegalHoldDto } from './dto';
import { CategoryPolicy, DEFAULT_RETENTION_POLICY, RETENTION_CATEGORIES, RetentionCategory } from './retention-policy';

const TERMINAL_STAGES: CaseStage[] = [CaseStage.CLOSED, CaseStage.TERMINATED, CaseStage.WITHDRAWN, CaseStage.SETTLED];

interface CategoryReport {
  category: RetentionCategory;
  behavior: string;
  retentionDays: number;
  eligible: number;
  blockedByLegalHold: number;
  note: string;
  sampleIds: string[];
}

/**
 * Controlled data-retention execution. Safe by design: nothing is deleted by
 * default. A sweep is dry-run first; execution requires a super-admin + explicit
 * confirmation + an opt-in category list; deletions are SOFT (tombstoned) and a
 * legal hold blocks deletion entirely. Awards, audit logs and service evidence
 * are RETAIN_FOREVER and can never be deleted by a sweep.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertCanManage(user: AuthUser) {
    if (!user.permissions.includes(Permission.SETTINGS_MANAGE)) {
      throw new ForbiddenException('Records retention requires the settings-management permission.');
    }
  }

  // ---- Policy --------------------------------------------------------------

  /** Effective policy: defaults merged with any `retention.policy` SystemSetting day overrides. */
  async getPolicy(): Promise<Record<RetentionCategory, CategoryPolicy>> {
    const policy: Record<RetentionCategory, CategoryPolicy> = JSON.parse(JSON.stringify(DEFAULT_RETENTION_POLICY));
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: 'retention.policy' } });
    if (setting) {
      try {
        const overrides = JSON.parse(setting.value) as Partial<Record<RetentionCategory, { days?: number }>>;
        for (const cat of RETENTION_CATEGORIES) {
          if (overrides[cat]?.days != null) policy[cat].days = overrides[cat]!.days!;
        }
      } catch {
        this.logger.warn('retention.policy SystemSetting is not valid JSON; using defaults.');
      }
    }
    return policy;
  }

  // ---- Legal hold ----------------------------------------------------------

  async placeLegalHold(user: AuthUser, dto: PlaceLegalHoldDto) {
    this.assertCanManage(user);
    const theCase = await this.prisma.case.findUnique({ where: { id: dto.caseId }, select: { id: true } });
    if (!theCase) throw new NotFoundException('Case not found.');
    const hold = await this.prisma.legalHold.create({
      data: { caseId: dto.caseId, reason: dto.reason, status: LegalHoldStatus.ACTIVE, placedById: user.id },
    });
    await this.prisma.case.update({ where: { id: dto.caseId }, data: { legalHold: true, retentionStatus: RetentionStatus.LEGAL_HOLD } });
    await this.audit.record({ userId: user.id, action: 'LEGAL_HOLD_PLACED', entityType: 'LegalHold', entityId: hold.id, caseId: dto.caseId, metadata: { reason: dto.reason } });
    return hold;
  }

  async releaseLegalHold(user: AuthUser, holdId: string, dto: ReleaseLegalHoldDto) {
    this.assertCanManage(user);
    const hold = await this.prisma.legalHold.findUnique({ where: { id: holdId } });
    if (!hold) throw new NotFoundException('Legal hold not found.');
    if (hold.status === LegalHoldStatus.RELEASED) return hold;
    const released = await this.prisma.legalHold.update({
      where: { id: holdId }, data: { status: LegalHoldStatus.RELEASED, releasedById: user.id, releaseNote: dto.note, releasedAt: new Date() },
    });
    // Only clear the case flag when no other ACTIVE hold remains.
    const remaining = await this.prisma.legalHold.count({ where: { caseId: hold.caseId, status: LegalHoldStatus.ACTIVE } });
    if (remaining === 0) {
      await this.prisma.case.update({ where: { id: hold.caseId }, data: { legalHold: false, retentionStatus: RetentionStatus.ACTIVE } });
    }
    await this.audit.record({ userId: user.id, action: 'LEGAL_HOLD_RELEASED', entityType: 'LegalHold', entityId: holdId, caseId: hold.caseId, metadata: { note: dto.note } });
    return released;
  }

  async listLegalHolds(user: AuthUser, status?: LegalHoldStatus) {
    this.assertCanManage(user);
    return this.prisma.legalHold.findMany({ where: { status }, orderBy: { placedAt: 'desc' } });
  }

  /** Guard used by case deletion paths: a case under legal hold cannot be deleted. */
  async assertNoLegalHold(caseId: string) {
    const active = await this.prisma.legalHold.count({ where: { caseId, status: LegalHoldStatus.ACTIVE } });
    if (active > 0) throw new BadRequestException('This case is under a legal hold and cannot be deleted.');
  }

  async caseRetentionStatus(user: AuthUser, caseId: string) {
    this.assertCanManage(user);
    const theCase = await this.prisma.case.findUnique({ where: { id: caseId }, select: { id: true, reference: true, stage: true, closedAt: true, deletedAt: true, legalHold: true, retentionStatus: true } });
    if (!theCase) throw new NotFoundException('Case not found.');
    const holds = await this.prisma.legalHold.findMany({ where: { caseId }, orderBy: { placedAt: 'desc' } });
    return { ...theCase, holds };
  }

  // ---- Sweep (dry-run + gated execution) -----------------------------------

  /** Evaluate every category and report what WOULD be eligible. Changes nothing. */
  async dryRunSweep(user: AuthUser) {
    this.assertCanManage(user);
    const runId = randomUUID();
    const policy = await this.getPolicy();
    const reports: CategoryReport[] = [];
    for (const category of RETENTION_CATEGORIES) {
      reports.push(await this.evaluateCategory(category, policy[category]));
    }
    await this.audit.record({ userId: user.id, action: 'RETENTION_DRY_RUN', entityType: 'RetentionSweep', entityId: runId, metadata: { totals: reports.map((r) => ({ c: r.category, eligible: r.eligible, held: r.blockedByLegalHold })) } });
    return { runId, dryRun: true, generatedAt: new Date().toISOString(), reports };
  }

  /**
   * Execute a sweep. GATED: super-admin role + `confirm: true` + an explicit
   * opt-in category list. Only SOFT_DELETE categories are acted on; RETAIN_FOREVER
   * is always refused; legal-held cases are skipped. Deletions are soft (deletedAt
   * + DELETED status) with a tombstone + preserved hash. Returns a summary.
   */
  async executeSweep(user: AuthUser, dto: ExecuteSweepDto) {
    this.assertCanManage(user);
    if (!user.roles.includes(Role.SUPER_ADMIN)) {
      throw new ForbiddenException('Only a super administrator may execute a retention sweep.');
    }
    if (dto.confirm !== true) {
      throw new BadRequestException('Execution requires explicit confirmation (confirm: true).');
    }
    const policy = await this.getPolicy();
    const runId = randomUUID();
    const summary: { category: RetentionCategory; softDeleted: number; skippedLegalHold: number; refused?: string }[] = [];

    for (const category of dto.categories) {
      const cat = policy[category];
      if (cat.behavior === 'RETAIN_FOREVER') {
        summary.push({ category, softDeleted: 0, skippedLegalHold: 0, refused: 'RETAIN_FOREVER — safeguarded; never deleted by a sweep' });
        continue;
      }
      if (cat.behavior === 'REVIEW') {
        summary.push({ category, softDeleted: 0, skippedLegalHold: 0, refused: 'REVIEW — flagged for human review; not auto-deleted' });
        continue;
      }
      // SOFT_DELETE — currently implemented at the case-record anchor.
      if (category === 'CASE_RECORD') {
        const { softDeleted, skippedLegalHold } = await this.softDeleteEligibleCases(user, runId, cat);
        summary.push({ category, softDeleted, skippedLegalHold });
      } else {
        // FILING / EVIDENCE_DOCUMENT are retained WITH the case record and are not
        // independently deleted by the sweep.
        summary.push({ category, softDeleted: 0, skippedLegalHold: 0, refused: 'retained with the case record; not independently deleted' });
      }
    }

    await this.audit.record({ userId: user.id, action: 'RETENTION_SWEEP_EXECUTED', entityType: 'RetentionSweep', entityId: runId, metadata: { categories: dto.categories, summary } });
    return { runId, dryRun: false, executedAt: new Date().toISOString(), summary };
  }

  private async softDeleteEligibleCases(user: AuthUser, runId: string, cat: CategoryPolicy) {
    const cutoff = new Date(Date.now() - cat.days * 86400000);
    const eligible = await this.prisma.case.findMany({
      where: { stage: { in: TERMINAL_STAGES }, deletedAt: null, closedAt: { lt: cutoff } },
      select: { id: true, reference: true, legalHold: true, updatedAt: true },
    });
    let softDeleted = 0;
    let skippedLegalHold = 0;
    for (const c of eligible) {
      if (c.legalHold) {
        skippedLegalHold++;
        await this.prisma.retentionSweepRecord.create({ data: { runId, dryRun: false, category: 'CASE_RECORD', entityType: 'Case', entityId: c.id, caseId: c.id, action: 'SKIPPED_LEGAL_HOLD', performedById: user.id } });
        continue;
      }
      // Preserve a hash of the minimal case identity as deletion evidence.
      const hash = createHash('sha256').update(`${c.id}:${c.reference}`).digest('hex');
      await this.prisma.case.update({ where: { id: c.id }, data: { deletedAt: new Date(), retentionStatus: RetentionStatus.DELETED } });
      await this.prisma.retentionSweepRecord.create({
        data: { runId, dryRun: false, category: 'CASE_RECORD', entityType: 'Case', entityId: c.id, caseId: c.id, action: 'SOFT_DELETED', reason: cat.description, hashPreserved: hash, performedById: user.id },
      });
      await this.audit.record({ userId: user.id, action: 'CASE_SOFT_DELETED_RETENTION', entityType: 'Case', entityId: c.id, caseId: c.id, metadata: { reference: c.reference, runId, hash } });
      softDeleted++;
    }
    return { softDeleted, skippedLegalHold };
  }

  /** Per-category eligibility evaluation for the dry run (no changes). */
  private async evaluateCategory(category: RetentionCategory, cat: CategoryPolicy): Promise<CategoryReport> {
    const base = { category, behavior: cat.behavior, retentionDays: cat.days } as const;
    if (cat.behavior === 'RETAIN_FOREVER') {
      return { ...base, eligible: 0, blockedByLegalHold: 0, note: 'Retained indefinitely (safeguarded).', sampleIds: [] };
    }
    const cutoff = new Date(Date.now() - cat.days * 86400000);
    switch (category) {
      case 'CASE_RECORD': {
        const eligibleCases = await this.prisma.case.findMany({ where: { stage: { in: TERMINAL_STAGES }, deletedAt: null, closedAt: { lt: cutoff } }, select: { id: true, legalHold: true }, take: 1000 });
        const held = eligibleCases.filter((c) => c.legalHold);
        const free = eligibleCases.filter((c) => !c.legalHold);
        return { ...base, eligible: free.length, blockedByLegalHold: held.length, note: `Closed cases past ${cat.days} days.`, sampleIds: free.slice(0, 5).map((c) => c.id) };
      }
      case 'AUTH_LOG': {
        const n = await this.prisma.loginEvent.count({ where: { createdAt: { lt: cutoff } } });
        return { ...base, eligible: n, blockedByLegalHold: 0, note: 'Login events past the period (review only).', sampleIds: [] };
      }
      case 'EMAIL_EVIDENCE': {
        const n = await this.prisma.emailDelivery.count({ where: { createdAt: { lt: cutoff } } });
        return { ...base, eligible: n, blockedByLegalHold: 0, note: 'Email delivery evidence past the period (review only; service evidence).', sampleIds: [] };
      }
      case 'COMPLIANCE_SCREENING': {
        const n = await this.prisma.screeningCheck.count({ where: { createdAt: { lt: cutoff } } });
        return { ...base, eligible: n, blockedByLegalHold: 0, note: 'Screening records past the period (review only).', sampleIds: [] };
      }
      case 'USER_ACCOUNT': {
        const n = await this.prisma.user.count({ where: { OR: [{ deletedAt: { lt: cutoff } }, { status: 'DEACTIVATED' }] } });
        return { ...base, eligible: n, blockedByLegalHold: 0, note: 'Deactivated accounts past the period (review only).', sampleIds: [] };
      }
      case 'FILING':
      case 'EVIDENCE_DOCUMENT':
        return { ...base, eligible: 0, blockedByLegalHold: 0, note: 'Retained with the case record (handled via CASE_RECORD).', sampleIds: [] };
      case 'CMS_CONTENT':
        return { ...base, eligible: 0, blockedByLegalHold: 0, note: 'Managed manually (archive/publish).', sampleIds: [] };
      default:
        return { ...base, eligible: 0, blockedByLegalHold: 0, note: 'No automatic evaluation.', sampleIds: [] };
    }
  }

  // ---- Export (pre-deletion bundle) ----------------------------------------

  /**
   * Export a retained case bundle manifest before deletion: case identity,
   * parties, stage history, and the hashes of documents, awards and service
   * certificates. The binaries themselves are exported separately from object
   * storage (see docs/DATA_RETENTION.md export process).
   */
  async exportCaseManifest(user: AuthUser, caseId: string) {
    this.assertCanManage(user);
    const c = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: {
        parties: { select: { side: true, legalName: true } },
        statusHistory: { select: { toStage: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
        documents: { include: { versions: { select: { version: true, fileName: true, fileHash: true, storageKey: true } } } },
        awards: { select: { id: true, type: true, issueDate: true, documentHash: true, generatedDocumentKey: true } },
      },
    });
    if (!c) throw new NotFoundException('Case not found.');
    const certificates = await this.prisma.serviceCertificate.findMany({
      where: { notice: { caseId } }, select: { certificateNumber: true, payloadHash: true, documentHash: true, documentKey: true },
    });
    const manifest = {
      generatedAt: new Date().toISOString(),
      case: { id: c.id, reference: c.reference, title: c.title, stage: c.stage, seat: c.seat, closedAt: c.closedAt },
      parties: c.parties,
      statusHistory: c.statusHistory,
      documents: c.documents.map((d) => ({ number: d.caseDocumentNumber, title: d.title, confidentiality: d.confidentiality, versions: d.versions })),
      awards: c.awards,
      serviceCertificates: certificates,
    };
    await this.audit.record({ userId: user.id, action: 'RETENTION_CASE_EXPORTED', entityType: 'Case', entityId: caseId, caseId, metadata: { documents: c.documents.length, awards: c.awards.length } });
    return manifest;
  }
}
