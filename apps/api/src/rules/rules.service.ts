import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RuleVersionStatus } from '@prisma/client';
import { Permission } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { AuthUser } from '../auth/types';
import { AcceptRulesDto, AssignRuleSetDto, RecordEventDto } from './dto';

interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class RulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
  ) {}

  // ---------------------------------------------------------------------------
  // PUBLIC RULES (no auth) — overview, versions, full text, model clauses
  // ---------------------------------------------------------------------------

  /** All rule sets with their versions (newest first). */
  async listRuleSets() {
    return this.prisma.ruleSet.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        versions: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, version: true, status: true, effectiveDate: true, supersededAt: true, changeSummary: true, changeSummaryAr: true },
        },
      },
    });
  }

  /** The currently active version for a rule set code. */
  async getActiveVersion(code: string) {
    const ruleSet = await this.prisma.ruleSet.findUnique({ where: { code } });
    if (!ruleSet) throw new NotFoundException('Rule set not found.');
    const version = await this.prisma.ruleSetVersion.findFirst({
      where: { ruleSetId: ruleSet.id, status: RuleVersionStatus.ACTIVE },
      orderBy: { effectiveDate: 'desc' },
    });
    if (!version) throw new NotFoundException('No active version for this rule set.');
    return this.getVersion(version.id, true);
  }

  /**
   * Full version content: chapters + rules. When `publicOnly` is true, only
   * rules flagged publicVisible are returned (used for the public site).
   */
  async getVersion(versionId: string, publicOnly = false) {
    const version = await this.prisma.ruleSetVersion.findUnique({
      where: { id: versionId },
      include: {
        ruleSet: true,
        chapters: {
          orderBy: { sortOrder: 'asc' },
          include: {
            rules: {
              where: publicOnly ? { publicVisible: true } : undefined,
              orderBy: { sortOrder: 'asc' },
              include: { deadlineDefinitions: true },
            },
          },
        },
      },
    });
    if (!version) throw new NotFoundException('Rule set version not found.');
    return version;
  }

  // ---------------------------------------------------------------------------
  // CASE RULE-SET PINNING
  // ---------------------------------------------------------------------------

  /**
   * Pin a case to a rule set version. Registrar action. A case may only be
   * pinned once: later amendments never silently re-pin an existing case.
   */
  async assignToCase(user: AuthUser, caseId: string, dto: AssignRuleSetDto) {
    await this.access.assertCanAccessCase(user, caseId);
    if (!user.permissions.includes(Permission.CASE_REGISTER)) {
      throw new ForbiddenException('Only the registry may assign the applicable rule set.');
    }
    const existing = await this.prisma.caseRuleSet.findUnique({ where: { caseId } });
    if (existing) {
      throw new BadRequestException('This case is already linked to a rule set version and cannot be silently re-pinned.');
    }
    const version = await this.prisma.ruleSetVersion.findUnique({ where: { id: dto.ruleSetVersionId } });
    if (!version) throw new NotFoundException('Rule set version not found.');
    if (version.status === RuleVersionStatus.DRAFT) {
      throw new BadRequestException('A draft rule set version cannot be applied to a case.');
    }

    const link = await this.prisma.caseRuleSet.create({
      data: {
        caseId,
        ruleSetVersionId: version.id,
        assignedById: user.id,
        agreedModifications: dto.agreedModifications ? JSON.stringify(dto.agreedModifications) : null,
      },
    });
    await this.audit.record({
      userId: user.id,
      action: 'CASE_RULESET_ASSIGNED',
      entityType: 'CaseRuleSet',
      entityId: link.id,
      caseId,
      metadata: { ruleSetVersionId: version.id, version: version.version },
    });
    return link;
  }

  /** The version (with content) applicable to a case, plus acceptances. */
  async getCaseRules(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    const link = await this.prisma.caseRuleSet.findUnique({
      where: { caseId },
      include: { ruleSetVersion: { include: { ruleSet: true } } },
    });
    const acceptances = await this.prisma.caseRuleAcceptance.findMany({
      where: { caseId },
      orderBy: { acceptedAt: 'asc' },
      select: {
        id: true, userId: true, partyRepresented: true, acceptedLanguage: true,
        seat: true, governingLaw: true, languageOfProceedings: true, numberOfArbitrators: true,
        appointmentMethod: true, consentElectronicService: true, consentOnlineHearings: true,
        receiptNumber: true, acceptedAt: true,
      },
    });
    return { link, acceptances };
  }

  // ---------------------------------------------------------------------------
  // RULE ACCEPTANCE (immutable receipt)
  // ---------------------------------------------------------------------------

  /**
   * Record a party's formal acceptance of the applicable rules. Produces an
   * immutable receipt (hash over the canonical payload). A user may only accept
   * once per case rule-set version.
   */
  async acceptRules(user: AuthUser, caseId: string, dto: AcceptRulesDto, ctx: RequestContext) {
    const membership = await this.access.assertCanAccessCase(user, caseId);
    if (!membership.isParty) {
      throw new ForbiddenException('Only a party or its authorised representative may accept the rules.');
    }
    const link = await this.prisma.caseRuleSet.findUnique({ where: { caseId } });
    if (!link) throw new BadRequestException('This case is not yet linked to a rule set version.');

    const already = await this.prisma.caseRuleAcceptance.findFirst({
      where: { caseId, userId: user.id, ruleSetVersionId: link.ruleSetVersionId },
    });
    if (already) {
      throw new BadRequestException('You have already accepted the applicable rules for this case.');
    }

    const acceptedAt = new Date();
    const receiptNumber = `ACC-${acceptedAt.getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const canonical = JSON.stringify({
      caseId,
      userId: user.id,
      ruleSetVersionId: link.ruleSetVersionId,
      partyRepresented: dto.partyRepresented ?? null,
      acceptedLanguage: dto.acceptedLanguage ?? user.email,
      seat: dto.seat ?? null,
      governingLaw: dto.governingLaw ?? null,
      languageOfProceedings: dto.languageOfProceedings ?? null,
      numberOfArbitrators: dto.numberOfArbitrators ?? null,
      appointmentMethod: dto.appointmentMethod ?? null,
      consentElectronicService: dto.consentElectronicService ?? false,
      consentOnlineHearings: dto.consentOnlineHearings ?? false,
      feeAllocationAgreement: dto.feeAllocationAgreement ?? null,
      acceptedModifications: dto.acceptedModifications ?? null,
      acceptedAt: acceptedAt.toISOString(),
    });
    const receiptHash = createHash('sha256').update(canonical).digest('hex');

    const acceptance = await this.prisma.caseRuleAcceptance.create({
      data: {
        caseId,
        userId: user.id,
        ruleSetVersionId: link.ruleSetVersionId,
        partyRepresented: dto.partyRepresented,
        representativeAuthority: dto.representativeAuthority,
        acceptedLanguage: dto.acceptedLanguage ?? 'en',
        seat: dto.seat,
        governingLaw: dto.governingLaw,
        languageOfProceedings: dto.languageOfProceedings,
        numberOfArbitrators: dto.numberOfArbitrators,
        appointmentMethod: dto.appointmentMethod,
        consentElectronicService: dto.consentElectronicService ?? false,
        consentOnlineHearings: dto.consentOnlineHearings ?? false,
        feeAllocationAgreement: dto.feeAllocationAgreement,
        acceptedModifications: dto.acceptedModifications ? JSON.stringify(dto.acceptedModifications) : null,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        authMethod: user.email ? 'password' : undefined,
        signatureMetadata: dto.signatureMetadata ? JSON.stringify(dto.signatureMetadata) : null,
        receiptNumber,
        receiptHash,
        acceptedAt,
      },
    });

    await this.audit.record({
      userId: user.id,
      action: 'RULES_ACCEPTED',
      entityType: 'CaseRuleAcceptance',
      entityId: acceptance.id,
      caseId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { receiptNumber, ruleSetVersionId: link.ruleSetVersionId },
    });

    return {
      receiptNumber: acceptance.receiptNumber,
      receiptHash: acceptance.receiptHash,
      acceptedAt: acceptance.acceptedAt,
      ruleSetVersionId: acceptance.ruleSetVersionId,
    };
  }

  // ---------------------------------------------------------------------------
  // PROCEDURAL EVENTS
  // ---------------------------------------------------------------------------

  /** Record a procedural event on a case (registrar/tribunal). */
  async recordEvent(user: AuthUser, caseId: string, dto: RecordEventDto) {
    const m = await this.access.assertCanAccessCase(user, caseId);
    if (!m.isTribunal && !m.isRegistrar && !user.permissions.includes(Permission.CASE_VIEW_QUEUE)) {
      throw new ForbiddenException('Only the registry or the tribunal may record procedural events.');
    }
    const event = await this.prisma.caseProceduralEvent.create({
      data: {
        caseId,
        type: dto.type,
        ruleId: dto.ruleId,
        actorUserId: user.id,
        effectiveDate: dto.effectiveDate,
        metadata: dto.metadata ? JSON.stringify(dto.metadata) : null,
      },
    });
    await this.audit.record({
      userId: user.id,
      action: 'PROCEDURAL_EVENT_RECORDED',
      entityType: 'CaseProceduralEvent',
      entityId: event.id,
      caseId,
      metadata: { type: dto.type },
    });
    return event;
  }

  async listEvents(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    return this.prisma.caseProceduralEvent.findMany({ where: { caseId }, orderBy: { occurredAt: 'asc' } });
  }
}
