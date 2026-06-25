import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { CaseStage, LegalHoldStatus, RetentionStatus } from '@prisma/client';
import { Permission, Role } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/types';
import { DraftPolicyDto, ExecuteSweepDto, PlaceLegalHoldDto, ReleaseLegalHoldDto, ReviewPolicyDto } from './dto';
import { CategoryPolicy, DEFAULT_RETENTION_POLICY, RETENTION_CATEGORIES, RetentionBehavior, RetentionCategory, SAFEGUARDED_CATEGORIES } from './retention-policy';

const POLICY_KEY = 'retention.policy';
const DRAFT_KEY = 'retention.policy.draft';

type PolicyOverride = { days?: number; behavior?: RetentionBehavior; note?: string };
type DraftStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
interface PolicyDraftState {
  overrides: Partial<Record<RetentionCategory, PolicyOverride>>;
  status: DraftStatus;
  proposedById: string;
  proposedByEmail: string;
  proposedAt: string;
  reviewedById?: string;
  reviewedByEmail?: string;
  reviewedAt?: string;
  reviewDecision?: 'APPROVE' | 'REJECT';
  reviewNote?: string;
}

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

  /** Manage = edit/activate policy, release holds, run/execute sweeps (Super Admin). */
  private assertCanManage(user: AuthUser) {
    if (!user.permissions.includes(Permission.SETTINGS_MANAGE)) {
      throw new ForbiddenException('Records retention requires the settings-management permission.');
    }
  }

  /** View = read policy + legal holds (Super Admin, Council reviewer, or Registrar). */
  private assertCanView(user: AuthUser) {
    const ok =
      user.permissions.includes(Permission.SETTINGS_MANAGE) ||
      user.permissions.includes(Permission.POLICY_MANAGE) ||
      user.permissions.includes(Permission.CASE_MANAGE_SERVICE);
    if (!ok) throw new ForbiddenException('You do not have permission to view retention settings.');
  }

  /** Review = approve/reject a policy draft (Council / legal reviewer). */
  private assertCanReview(user: AuthUser) {
    if (!user.permissions.includes(Permission.POLICY_MANAGE)) {
      throw new ForbiddenException('Reviewing a retention policy change requires the policy-management (council) permission.');
    }
  }

  /** Request/place a legal hold (Super Admin or Registrar). Holds only BLOCK deletion. */
  private assertCanRequestHold(user: AuthUser) {
    const ok = user.permissions.includes(Permission.SETTINGS_MANAGE) || user.permissions.includes(Permission.CASE_MANAGE_SERVICE);
    if (!ok) throw new ForbiddenException('Placing a legal hold requires settings-management or case-service permission.');
  }

  // ---- Policy --------------------------------------------------------------

  /**
   * Effective policy: defaults merged with the active `retention.policy` overrides
   * (days, behaviour and note). Safeguarded categories (awards, audit log, service
   * certificates) are always clamped to RETAIN_FOREVER so a policy edit can never
   * make them deletable.
   */
  async getPolicy(): Promise<Record<RetentionCategory, CategoryPolicy>> {
    const policy: Record<RetentionCategory, CategoryPolicy> = JSON.parse(JSON.stringify(DEFAULT_RETENTION_POLICY));
    const overrides = await this.readOverrides(POLICY_KEY);
    for (const cat of RETENTION_CATEGORIES) {
      const o = overrides[cat];
      if (!o) continue;
      if (o.days != null) policy[cat].days = o.days;
      if (o.behavior != null) policy[cat].behavior = o.behavior;
      if (o.note != null) policy[cat].note = o.note;
    }
    // Safeguard clamp — never deletable regardless of stored override.
    for (const cat of SAFEGUARDED_CATEGORIES) {
      if (policy[cat as RetentionCategory]) policy[cat as RetentionCategory].behavior = 'RETAIN_FOREVER';
    }
    return policy;
  }

  /** View the effective policy (gated). */
  async viewPolicy(user: AuthUser) {
    this.assertCanView(user);
    return this.getPolicy();
  }

  private async readOverrides(key: string): Promise<Partial<Record<RetentionCategory, PolicyOverride>>> {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (!setting) return {};
    try {
      return JSON.parse(setting.value) as Partial<Record<RetentionCategory, PolicyOverride>>;
    } catch {
      this.logger.warn(`${key} SystemSetting is not valid JSON; ignoring.`);
      return {};
    }
  }

  private async readDraft(): Promise<PolicyDraftState | null> {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: DRAFT_KEY } });
    if (!setting) return null;
    try {
      return JSON.parse(setting.value) as PolicyDraftState;
    } catch {
      return null;
    }
  }

  private async writeSetting(key: string, value: unknown, userId: string) {
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: JSON.stringify(value), updatedBy: userId },
      update: { value: JSON.stringify(value), updatedBy: userId },
    });
  }

  // ---- Policy editing workflow: draft → review → activate -------------------

  /** Current draft policy-change (if any) plus its workflow status. Gated to viewers. */
  async getPolicyDraft(user: AuthUser) {
    this.assertCanView(user);
    return { draft: await this.readDraft() };
  }

  /**
   * Draft a policy change (Super Admin). Optionally submit it for council/legal
   * review. Behaviour changes on safeguarded categories are refused. Nothing takes
   * effect until the draft is approved and explicitly activated.
   */
  async draftPolicy(user: AuthUser, dto: DraftPolicyDto) {
    this.assertCanManage(user);
    const overrides: Partial<Record<RetentionCategory, PolicyOverride>> = {};
    for (const e of dto.entries) {
      if (SAFEGUARDED_CATEGORIES.includes(e.category) && e.behavior && e.behavior !== 'RETAIN_FOREVER') {
        throw new BadRequestException(`${e.category} is safeguarded and must remain RETAIN_FOREVER.`);
      }
      const o: PolicyOverride = {};
      if (e.days != null) o.days = e.days;
      if (e.behavior != null) o.behavior = e.behavior;
      if (e.note != null) o.note = e.note;
      overrides[e.category] = o;
    }
    const state: PolicyDraftState = {
      overrides,
      status: dto.submitForReview ? 'PENDING_REVIEW' : 'DRAFT',
      proposedById: user.id,
      proposedByEmail: user.email,
      proposedAt: new Date().toISOString(),
    };
    await this.writeSetting(DRAFT_KEY, state, user.id);
    await this.audit.record({
      userId: user.id, action: 'RETENTION_POLICY_DRAFTED', entityType: 'RetentionPolicy', entityId: DRAFT_KEY,
      metadata: { entries: dto.entries, status: state.status, by: user.email },
    });
    return state;
  }

  /** Approve or reject a pending policy draft (Council / legal reviewer). */
  async reviewPolicy(user: AuthUser, dto: ReviewPolicyDto) {
    this.assertCanReview(user);
    const draft = await this.readDraft();
    if (!draft) throw new NotFoundException('There is no policy draft to review.');
    if (draft.status !== 'PENDING_REVIEW') {
      throw new BadRequestException(`Draft is ${draft.status}; only a PENDING_REVIEW draft can be reviewed.`);
    }
    const next: PolicyDraftState = {
      ...draft,
      status: dto.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      reviewedById: user.id,
      reviewedByEmail: user.email,
      reviewedAt: new Date().toISOString(),
      reviewDecision: dto.decision,
      reviewNote: dto.note,
    };
    await this.writeSetting(DRAFT_KEY, next, user.id);
    await this.audit.record({
      userId: user.id, action: 'RETENTION_POLICY_REVIEWED', entityType: 'RetentionPolicy', entityId: DRAFT_KEY,
      metadata: { decision: dto.decision, note: dto.note, by: user.email },
    });
    return next;
  }

  /**
   * Activate an APPROVED draft (Super Admin): merge it into the active policy,
   * audit each changed retention period, and clear the draft. Refuses unless the
   * draft has been approved by a reviewer.
   */
  async activatePolicy(user: AuthUser) {
    this.assertCanManage(user);
    const draft = await this.readDraft();
    if (!draft) throw new NotFoundException('There is no policy draft to activate.');
    if (draft.status !== 'APPROVED') {
      throw new BadRequestException('Only an APPROVED draft can be activated. Submit it for review and obtain approval first.');
    }
    const before = await this.getPolicy();
    const active = await this.readOverrides(POLICY_KEY);
    for (const cat of Object.keys(draft.overrides) as RetentionCategory[]) {
      active[cat] = { ...(active[cat] ?? {}), ...draft.overrides[cat] };
    }
    await this.writeSetting(POLICY_KEY, active, user.id);
    await this.prisma.systemSetting.delete({ where: { key: DRAFT_KEY } }).catch(() => undefined);

    const after = await this.getPolicy();
    for (const cat of Object.keys(draft.overrides) as RetentionCategory[]) {
      if (before[cat] && after[cat] && (before[cat].days !== after[cat].days || before[cat].behavior !== after[cat].behavior)) {
        await this.audit.record({
          userId: user.id, action: 'RETENTION_PERIOD_CHANGED', entityType: 'RetentionPolicy', entityId: cat,
          metadata: { category: cat, fromDays: before[cat].days, toDays: after[cat].days, fromBehavior: before[cat].behavior, toBehavior: after[cat].behavior, by: user.email },
        });
      }
    }
    await this.audit.record({
      userId: user.id, action: 'RETENTION_POLICY_ACTIVATED', entityType: 'RetentionPolicy', entityId: POLICY_KEY,
      metadata: { categories: Object.keys(draft.overrides), reviewedBy: draft.reviewedByEmail, by: user.email },
    });
    return after;
  }

  // ---- Legal hold ----------------------------------------------------------

  async placeLegalHold(user: AuthUser, dto: PlaceLegalHoldDto) {
    this.assertCanRequestHold(user);
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
    this.assertCanView(user);
    return this.prisma.legalHold.findMany({ where: { status }, orderBy: { placedAt: 'desc' } });
  }

  /** Guard used by case deletion paths: a case under legal hold cannot be deleted. */
  async assertNoLegalHold(caseId: string) {
    const active = await this.prisma.legalHold.count({ where: { caseId, status: LegalHoldStatus.ACTIVE } });
    if (active > 0) throw new BadRequestException('This case is under a legal hold and cannot be deleted.');
  }

  async caseRetentionStatus(user: AuthUser, caseId: string) {
    this.assertCanView(user);
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
      // Only SOFT_DELETE is ever acted on. Every other behaviour is refused so a
      // sweep can never delete RETAIN_FOREVER / REVIEW / ARCHIVE / LEGAL_HOLD_REQUIRED.
      if (cat.behavior !== 'SOFT_DELETE') {
        const reason: Record<RetentionBehavior, string> = {
          RETAIN_FOREVER: 'RETAIN_FOREVER — safeguarded; never deleted by a sweep',
          REVIEW: 'REVIEW — flagged for human review; not auto-deleted',
          ARCHIVE: 'ARCHIVE — moved to cold archive; not deleted by a sweep',
          LEGAL_HOLD_REQUIRED: 'LEGAL_HOLD_REQUIRED — deletion only under an explicit legal process',
          SOFT_DELETE: '',
        };
        summary.push({ category, softDeleted: 0, skippedLegalHold: 0, refused: reason[cat.behavior] });
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
