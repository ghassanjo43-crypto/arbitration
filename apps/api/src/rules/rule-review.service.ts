import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RuleReviewStatus, RuleVersionStatus } from '@prisma/client';
import { Permission } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/types';
import { CreateDraftVersionDto, RecordReviewDto, UpdateRuleTextDto } from './dto';

/** Textual fields a reviewer/author may edit on a rule (counsel-review surface). */
const EDITABLE_RULE_FIELDS = ['title', 'titleAr', 'text', 'textAr', 'mandatoryLawWarning', 'publicVisible'] as const;
const DIFF_FIELDS = ['title', 'titleAr', 'text', 'textAr', 'mandatoryLawWarning', 'publicVisible'] as const;

/**
 * Counsel-review workflow for the procedural rules: authoring (clone a draft),
 * diffing two versions, recording counsel's per-rule review decision, and a
 * gated activation that refuses to publish a draft until every rule is cleared.
 *
 * The platform never performs the legal review itself — it records counsel's
 * decisions and enforces that an un-cleared draft cannot go live. All admin
 * actions require POLICY_MANAGE (the council/policy function).
 */
@Injectable()
export class RuleReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertCanManage(user: AuthUser) {
    if (!user.permissions.includes(Permission.POLICY_MANAGE)) {
      throw new ForbiddenException('Managing rule versions requires the policy-management permission.');
    }
  }

  // ---- Authoring / versioning --------------------------------------------

  /** All versions of all rule sets, each with a review summary (admin view). */
  async listVersions(user: AuthUser) {
    this.assertCanManage(user);
    const versions = await this.prisma.ruleSetVersion.findMany({
      orderBy: [{ ruleSetId: 'asc' }, { createdAt: 'desc' }],
      include: { ruleSet: { select: { code: true, title: true } }, _count: { select: { rules: true } } },
    });
    const summaries = await Promise.all(versions.map((v) => this.summarise(v.id)));
    return versions.map((v, i) => ({
      id: v.id,
      ruleSetCode: v.ruleSet.code,
      version: v.version,
      status: v.status,
      effectiveDate: v.effectiveDate,
      ruleCount: v._count.rules,
      review: summaries[i],
    }));
  }

  /** Full draft content with each rule's review item (counsel review surface). */
  async getVersionForReview(user: AuthUser, versionId: string) {
    this.assertCanManage(user);
    const version = await this.prisma.ruleSetVersion.findUnique({
      where: { id: versionId },
      include: {
        ruleSet: true,
        chapters: { orderBy: { sortOrder: 'asc' }, include: { rules: { orderBy: { sortOrder: 'asc' } } } },
        reviewItems: true,
      },
    });
    if (!version) throw new NotFoundException('Rule set version not found.');
    const reviewByRule = new Map(version.reviewItems.map((r) => [r.ruleId, r]));
    return {
      id: version.id,
      version: version.version,
      status: version.status,
      ruleSet: { code: version.ruleSet.code, title: version.ruleSet.title },
      review: await this.summarise(version.id),
      chapters: version.chapters.map((ch) => ({
        id: ch.id, number: ch.number, title: ch.title,
        rules: ch.rules.map((r) => ({
          id: r.id, number: r.number, title: r.title, titleAr: r.titleAr, text: r.text, textAr: r.textAr,
          mandatoryLawWarning: r.mandatoryLawWarning, publicVisible: r.publicVisible,
          review: reviewByRule.get(r.id)
            ? { status: reviewByRule.get(r.id)!.status, jurisdiction: reviewByRule.get(r.id)!.jurisdiction, note: reviewByRule.get(r.id)!.note, reviewedAt: reviewByRule.get(r.id)!.reviewedAt }
            : { status: RuleReviewStatus.PENDING, jurisdiction: null, note: null, reviewedAt: null },
        })),
      })),
    };
  }

  /**
   * Create a new DRAFT version by deep-cloning an existing version's chapters,
   * rules and deadline definitions. This is the authoring entry point: counsel
   * reviews the draft, not the live version.
   */
  async createDraftVersion(user: AuthUser, dto: CreateDraftVersionDto) {
    this.assertCanManage(user);
    const source = await this.prisma.ruleSetVersion.findUnique({
      where: { id: dto.fromVersionId },
      include: { chapters: true, rules: { include: { deadlineDefinitions: true } } },
    });
    if (!source) throw new NotFoundException('Source rule set version not found.');

    const dupe = await this.prisma.ruleSetVersion.findFirst({ where: { ruleSetId: source.ruleSetId, version: dto.version } });
    if (dupe) throw new BadRequestException(`Version "${dto.version}" already exists for this rule set.`);

    const created = await this.prisma.$transaction(async (tx) => {
      const draft = await tx.ruleSetVersion.create({
        data: {
          ruleSetId: source.ruleSetId,
          version: dto.version,
          status: RuleVersionStatus.DRAFT,
          changeSummary: dto.changeSummary,
          changeSummaryAr: dto.changeSummaryAr,
          mandatoryLawNotice: source.mandatoryLawNotice,
          mandatoryLawNoticeAr: source.mandatoryLawNoticeAr,
        },
      });
      // Clone chapters (old chapterId -> new chapterId).
      const chapterMap = new Map<string, string>();
      for (const ch of source.chapters) {
        const nc = await tx.ruleChapter.create({
          data: { versionId: draft.id, number: ch.number, title: ch.title, titleAr: ch.titleAr, summary: ch.summary, summaryAr: ch.summaryAr, sortOrder: ch.sortOrder },
        });
        chapterMap.set(ch.id, nc.id);
      }
      // Clone rules + their deadline definitions.
      for (const r of source.rules) {
        const nr = await tx.rule.create({
          data: {
            versionId: draft.id, chapterId: chapterMap.get(r.chapterId)!, number: r.number, title: r.title, titleAr: r.titleAr,
            text: r.text, textAr: r.textAr, status: r.status, sortOrder: r.sortOrder,
            triggeringEvent: r.triggeringEvent, responsibleRole: r.responsibleRole, permittedAction: r.permittedAction,
            requiredNotice: r.requiredNotice, requiredDocuments: r.requiredDocuments, feeConsequence: r.feeConsequence,
            defaultConsequence: r.defaultConsequence, extensionAuthority: r.extensionAuthority, waiverAuthority: r.waiverAuthority,
            applicableCaseTypes: r.applicableCaseTypes, applicableRoles: r.applicableRoles, auditRequired: r.auditRequired,
            mandatoryLawWarning: r.mandatoryLawWarning, publicVisible: r.publicVisible,
            deadlineDefinitions: {
              create: r.deadlineDefinitions.map((d) => ({
                key: d.key, label: d.label, labelAr: d.labelAr, triggerEvent: d.triggerEvent, days: d.days, dayKind: d.dayKind,
                responsibleRole: d.responsibleRole, requiredAction: d.requiredAction, extensionAuthority: d.extensionAuthority, reminderRule: d.reminderRule,
              })),
            },
          },
        });
        // Seed a PENDING review item for every cloned rule.
        await tx.ruleReviewItem.create({ data: { versionId: draft.id, ruleId: nr.id, status: RuleReviewStatus.PENDING } });
      }
      return draft;
    });

    await this.audit.record({
      userId: user.id, action: 'RULE_VERSION_DRAFTED', entityType: 'RuleSetVersion', entityId: created.id,
      metadata: { fromVersionId: dto.fromVersionId, version: dto.version },
    });
    return { id: created.id, version: created.version, status: created.status };
  }

  /** Edit a rule's text. Permitted ONLY while its version is DRAFT. Editing a
   *  rule resets its review item to PENDING so a change cannot bypass review. */
  async updateRuleText(user: AuthUser, ruleId: string, dto: UpdateRuleTextDto) {
    this.assertCanManage(user);
    const rule = await this.prisma.rule.findUnique({ where: { id: ruleId }, include: { version: { select: { id: true, status: true } } } });
    if (!rule) throw new NotFoundException('Rule not found.');
    if (rule.version.status !== RuleVersionStatus.DRAFT) {
      throw new BadRequestException('Only rules in a DRAFT version may be edited. Active versions are immutable.');
    }
    const data: Record<string, unknown> = {};
    for (const f of EDITABLE_RULE_FIELDS) if (dto[f as keyof UpdateRuleTextDto] !== undefined) data[f] = dto[f as keyof UpdateRuleTextDto];
    if (Object.keys(data).length === 0) throw new BadRequestException('No editable fields supplied.');

    const updated = await this.prisma.rule.update({ where: { id: ruleId }, data });
    // Any text change re-opens review for that rule.
    await this.prisma.ruleReviewItem.upsert({
      where: { versionId_ruleId: { versionId: rule.version.id, ruleId } },
      update: { status: RuleReviewStatus.PENDING, reviewedById: null, reviewedAt: null },
      create: { versionId: rule.version.id, ruleId, status: RuleReviewStatus.PENDING },
    });
    await this.audit.record({ userId: user.id, action: 'RULE_TEXT_EDITED', entityType: 'Rule', entityId: ruleId, metadata: { fields: Object.keys(data) } });
    return updated;
  }

  // ---- Diff ---------------------------------------------------------------

  /** Per-rule diff between two versions, matched by rule number. */
  async diff(user: AuthUser, baseVersionId: string, targetVersionId: string) {
    this.assertCanManage(user);
    const [base, target] = await Promise.all([
      this.prisma.rule.findMany({ where: { versionId: baseVersionId } }),
      this.prisma.rule.findMany({ where: { versionId: targetVersionId } }),
    ]);
    if (base.length === 0 && target.length === 0) throw new NotFoundException('Neither version has any rules (check the ids).');

    const baseByNum = new Map(base.map((r) => [r.number, r]));
    const targetByNum = new Map(target.map((r) => [r.number, r]));
    const numbers = [...new Set([...baseByNum.keys(), ...targetByNum.keys()])].sort();

    const entries = numbers.map((number) => {
      const b = baseByNum.get(number);
      const t = targetByNum.get(number);
      if (b && !t) return { number, status: 'REMOVED' as const, title: b.title };
      if (!b && t) return { number, status: 'ADDED' as const, title: t.title };
      const changedFields = DIFF_FIELDS.filter((f) => String((b as Record<string, unknown>)[f] ?? '') !== String((t as Record<string, unknown>)[f] ?? ''));
      return changedFields.length
        ? { number, status: 'CHANGED' as const, title: t!.title, changedFields, base: this.pick(b!), target: this.pick(t!) }
        : { number, status: 'UNCHANGED' as const, title: t!.title };
    });

    const summary = {
      added: entries.filter((e) => e.status === 'ADDED').length,
      removed: entries.filter((e) => e.status === 'REMOVED').length,
      changed: entries.filter((e) => e.status === 'CHANGED').length,
      unchanged: entries.filter((e) => e.status === 'UNCHANGED').length,
    };
    return { summary, entries };
  }

  private pick(r: Record<string, unknown>) {
    return { title: r.title, titleAr: r.titleAr, text: r.text, textAr: r.textAr, mandatoryLawWarning: r.mandatoryLawWarning, publicVisible: r.publicVisible };
  }

  // ---- Review decisions ---------------------------------------------------

  /** Record (upsert) counsel's review decision for one rule in a draft version. */
  async recordReview(user: AuthUser, versionId: string, ruleId: string, dto: RecordReviewDto) {
    this.assertCanManage(user);
    const rule = await this.prisma.rule.findFirst({ where: { id: ruleId, versionId }, include: { version: { select: { status: true } } } });
    if (!rule) throw new NotFoundException('Rule not found in this version.');
    if (rule.version.status !== RuleVersionStatus.DRAFT) {
      throw new BadRequestException('Review decisions may only be recorded against a DRAFT version.');
    }
    const item = await this.prisma.ruleReviewItem.upsert({
      where: { versionId_ruleId: { versionId, ruleId } },
      update: { status: dto.status, jurisdiction: dto.jurisdiction, note: dto.note, reviewedById: user.id, reviewedAt: new Date() },
      create: { versionId, ruleId, status: dto.status, jurisdiction: dto.jurisdiction, note: dto.note, reviewedById: user.id, reviewedAt: new Date() },
    });
    await this.audit.record({
      userId: user.id, action: 'RULE_REVIEW_RECORDED', entityType: 'RuleReviewItem', entityId: item.id,
      metadata: { versionId, ruleId, status: dto.status, jurisdiction: dto.jurisdiction },
    });
    return item;
  }

  /** Counts of review states for a version, and whether it is clear to activate. */
  async summarise(versionId: string) {
    const [ruleCount, items] = await Promise.all([
      this.prisma.rule.count({ where: { versionId } }),
      this.prisma.ruleReviewItem.findMany({ where: { versionId }, select: { status: true } }),
    ]);
    const counts = { OK: 0, CHANGE_REQUIRED: 0, BLOCKER: 0, PENDING: 0 } as Record<RuleReviewStatus, number>;
    for (const i of items) counts[i.status]++;
    // Rules with no review item at all are implicitly PENDING.
    const unreviewed = ruleCount - items.length;
    counts.PENDING += Math.max(0, unreviewed);
    const clearToActivate = ruleCount > 0 && counts.OK === ruleCount;
    return { ruleCount, ...counts, clearToActivate };
  }

  // ---- Gated activation ---------------------------------------------------

  /**
   * Activate a DRAFT version. GATED: refuses unless every rule has been reviewed
   * OK (no PENDING / CHANGE_REQUIRED / BLOCKER). On success, supersedes the prior
   * ACTIVE version of the same rule set. Existing cases are unaffected — they
   * remain pinned to their own version.
   */
  async activateVersion(user: AuthUser, versionId: string) {
    this.assertCanManage(user);
    const version = await this.prisma.ruleSetVersion.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException('Rule set version not found.');
    if (version.status !== RuleVersionStatus.DRAFT) {
      throw new BadRequestException('Only a DRAFT version can be activated.');
    }
    const summary = await this.summarise(versionId);
    if (!summary.clearToActivate) {
      throw new BadRequestException(
        `Counsel review is incomplete: ${summary.PENDING} pending, ${summary.CHANGE_REQUIRED} change-required, ${summary.BLOCKER} blocker(s). Every rule must be reviewed OK before activation.`,
      );
    }

    const now = new Date();
    await this.prisma.$transaction([
      // Supersede the current ACTIVE version(s) of this rule set.
      this.prisma.ruleSetVersion.updateMany({
        where: { ruleSetId: version.ruleSetId, status: RuleVersionStatus.ACTIVE },
        data: { status: RuleVersionStatus.SUPERSEDED, supersededAt: now },
      }),
      this.prisma.ruleSetVersion.update({
        where: { id: versionId },
        data: { status: RuleVersionStatus.ACTIVE, effectiveDate: now, publishedById: user.id },
      }),
    ]);
    await this.audit.record({
      userId: user.id, action: 'RULE_VERSION_ACTIVATED', entityType: 'RuleSetVersion', entityId: versionId,
      metadata: { version: version.version, ruleCount: summary.ruleCount },
    });
    return { id: versionId, status: RuleVersionStatus.ACTIVE, effectiveDate: now };
  }
}
