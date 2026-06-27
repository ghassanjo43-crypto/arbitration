import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseRole, CaseStage, PartySide, Permission, Role } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../auth/types';
import { AddCaseNoteDto, CreateCaseDraftDto, DeliberationNoteDto, ProceduralOrderDto, SubmitCaseDto, UpdateCaseAdminDto } from './dto';

@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  private async nextReference(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.case.count({
      where: { reference: { startsWith: `GAAP-${year}-` } },
    });
    return `GAAP-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  async createDraft(user: AuthUser, dto: CreateCaseDraftDto) {
    const reference = await this.nextReference();
    const created = await this.prisma.case.create({
      data: {
        reference,
        title: dto.title,
        stage: CaseStage.DRAFT,
        filingCapacity: dto.filingCapacity,
        category: dto.category,
        industry: dto.industry,
        seat: dto.seat,
        governingLaw: dto.governingLaw,
        language: dto.language ?? 'en',
        numberOfArbitrators: dto.numberOfArbitrators,
        onlineConsent: dto.onlineConsent ?? false,
        electronicServiceConsent: dto.electronicServiceConsent ?? false,
        filedById: user.id,
        parties: {
          create: [
            ...(dto.claimants ?? []).map((p) => ({ ...p, side: PartySide.CLAIMANT })),
            ...(dto.respondents ?? []).map((p) => ({ ...p, side: PartySide.RESPONDENT })),
          ],
        },
        teamMembers: {
          create: { userId: user.id, caseRole: CaseRole.CLAIMANT, side: PartySide.CLAIMANT },
        },
        statusHistory: { create: { toStage: CaseStage.DRAFT, changedBy: user.id } },
      },
    });
    await this.audit.record({
      userId: user.id,
      action: 'CASE_DRAFT_CREATED',
      entityType: 'Case',
      entityId: created.id,
      caseId: created.id,
    });
    return { id: created.id, reference: created.reference, stage: created.stage };
  }

  async listMyCases(user: AuthUser) {
    const memberships = await this.prisma.caseTeamMember.findMany({
      where: { userId: user.id, active: true },
      include: { case: { include: { deadlines: { where: { status: 'OPEN' }, orderBy: { dueAt: 'asc' }, take: 1 } } } },
    });
    const byCase = new Map<string, { roles: CaseRole[]; case: (typeof memberships)[number]['case'] }>();
    for (const m of memberships) {
      const entry = byCase.get(m.caseId) ?? { roles: [], case: m.case };
      entry.roles.push(m.caseRole as CaseRole);
      byCase.set(m.caseId, entry);
    }
    return [...byCase.values()].map(({ roles, case: c }) => ({
      id: c.id,
      reference: c.reference,
      title: c.title,
      stage: c.stage,
      myCaseRoles: roles,
      nextDeadlineAt: c.deadlines[0]?.dueAt ?? null,
      updatedAt: c.updatedAt,
    }));
  }

  async getCase(user: AuthUser, caseId: string) {
    const membership = await this.access.assertCanAccessCase(user, caseId);
    const c = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: {
        parties: { include: { representatives: true } },
        teamMembers: true,
        agreement: true,
        claims: true,
        reliefRequests: true,
        statusHistory: { orderBy: { createdAt: 'desc' }, take: 20 },
        tribunal: { include: { members: true } },
        deadlines: { orderBy: { dueAt: 'asc' } },
        hearings: true,
        proceduralOrders: { orderBy: { number: 'desc' } },
        awards: true,
      },
    });
    if (!c) throw new NotFoundException('Case not found.');
    return { ...c, _membership: membership };
  }

  async submit(user: AuthUser, caseId: string, dto: SubmitCaseDto) {
    const required = [
      dto.informationAccurate,
      dto.authorisedToFile,
      dto.acceptPortalTerms,
      dto.understandsJurisdiction,
      dto.understandsNoEnforcementGuarantee,
      dto.acceptElectronicService,
    ];
    if (required.some((v) => v !== true)) {
      throw new BadRequestException('All declarations must be confirmed before submission.');
    }
    const membership = await this.access.assertCanAccessCase(user, caseId);
    if (!membership.caseRoles.includes(CaseRole.CLAIMANT) && !membership.caseRoles.includes(CaseRole.CLAIMANT_REPRESENTATIVE)) {
      throw new ForbiddenException('Only the filing party may submit this case.');
    }
    const c = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!c) throw new NotFoundException('Case not found.');
    if (c.stage !== CaseStage.DRAFT) throw new BadRequestException('Only draft cases can be submitted.');

    await this.prisma.$transaction([
      this.prisma.case.update({ where: { id: caseId }, data: { stage: CaseStage.SUBMITTED } }),
      this.prisma.caseStatusHistory.create({
        data: { caseId, fromStage: CaseStage.DRAFT, toStage: CaseStage.SUBMITTED, changedBy: user.id },
      }),
    ]);
    await this.audit.record({ userId: user.id, action: 'CASE_SUBMITTED', entityType: 'Case', entityId: caseId, caseId });
    return { id: caseId, stage: CaseStage.SUBMITTED };
  }

  // ---- Tribunal deliberations: tribunal-only, on this specific case ----

  async listDeliberations(user: AuthUser, caseId: string) {
    await this.access.assertDeliberationAccess(user, caseId);
    return this.prisma.deliberationNote.findMany({ where: { caseId }, orderBy: { createdAt: 'desc' } });
  }

  async addDeliberation(user: AuthUser, caseId: string, dto: DeliberationNoteDto) {
    await this.access.assertDeliberationAccess(user, caseId);
    const tribunal = await this.prisma.tribunal.findUnique({ where: { caseId } });
    if (!tribunal) throw new BadRequestException('Tribunal not yet constituted.');
    const note = await this.prisma.deliberationNote.create({
      data: { caseId, tribunalId: tribunal.id, authorUserId: user.id, body: dto.body },
    });
    await this.audit.record({
      userId: user.id,
      action: 'DELIBERATION_NOTE_ADDED',
      entityType: 'DeliberationNote',
      entityId: note.id,
      caseId,
    });
    return note;
  }

  // ---- Procedural orders: tribunal-issued (Ch19) ----

  async listProceduralOrders(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    return this.prisma.proceduralOrder.findMany({ where: { caseId }, orderBy: { number: 'asc' } });
  }

  /** Only the tribunal may issue a procedural order. Parties are notified. */
  async issueProceduralOrder(user: AuthUser, caseId: string, dto: ProceduralOrderDto) {
    const m = await this.access.assertCanAccessCase(user, caseId);
    if (!m.isTribunal) throw new ForbiddenException('Only the tribunal may issue a procedural order.');
    const count = await this.prisma.proceduralOrder.count({ where: { caseId } });
    const number = count + 1;
    const order = await this.prisma.proceduralOrder.create({
      data: { caseId, number, title: dto.title, body: dto.body, issuedById: user.id },
    });
    await this.audit.record({ userId: user.id, action: 'PROCEDURAL_ORDER_ISSUED', entityType: 'ProceduralOrder', entityId: order.id, caseId, metadata: { number } });

    const ref = await this.prisma.case.findUnique({ where: { id: caseId }, select: { reference: true } });
    await this.notifications.notifyCaseMembers({
      caseId, key: 'ORDER_ISSUED',
      vars: { caseRef: ref?.reference ?? caseId, orderTitle: `Procedural Order No. ${number} — ${dto.title}` },
      link: `/app/cases/${caseId}`, partyOnly: true,
    });
    return order;
  }

  // ---- Registrar administration (non-merits) -------------------------------

  /**
   * Administrative reach: registrars/admins (CASE_VIEW_QUEUE) and super-admins.
   * This is the SAME boundary the case-access layer uses — it grants the right to
   * administer the case, never to read deliberations or decide the merits.
   */
  private assertCanAdminister(user: AuthUser) {
    const ok = user.permissions.includes(Permission.CASE_VIEW_QUEUE) || user.roles.includes(Role.SUPER_ADMIN);
    if (!ok) throw new ForbiddenException('Only registry/administrative staff may administer case information.');
  }

  /**
   * Edit a case's administrative (non-merits) fields. The registrar may correct
   * logistics — title, seat, governing law, language, panel size, appointment
   * mechanism, sensitivity — but nothing here touches the substance of the
   * dispute, the tribunal's reasoning, or any award. Every change is audited.
   */
  async updateAdminInfo(user: AuthUser, caseId: string, dto: UpdateCaseAdminDto) {
    await this.access.assertCanAccessCase(user, caseId);
    this.assertCanAdminister(user);

    const data: Record<string, unknown> = {};
    for (const key of ['title', 'category', 'industry', 'seat', 'governingLaw', 'language', 'numberOfArbitrators', 'appointmentMechanism', 'confidentialitySensitivity'] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    if (Object.keys(data).length === 0) throw new BadRequestException('No administrative fields to update.');

    const updated = await this.prisma.case.update({
      where: { id: caseId },
      data,
      select: {
        id: true, reference: true, title: true, stage: true, category: true, industry: true,
        seat: true, governingLaw: true, language: true, numberOfArbitrators: true,
        appointmentMechanism: true, confidentialitySensitivity: true,
      },
    });
    await this.audit.record({
      userId: user.id, action: 'CASE_ADMIN_UPDATED', entityType: 'Case', entityId: caseId, caseId,
      metadata: { fields: Object.keys(data), by: user.email },
    });
    return updated;
  }

  /**
   * Add an administrative note to the case. Notes are stored on the append-only
   * audit trail (action CASE_ADMIN_NOTE), so they are inherently logged and cannot
   * be silently edited or removed. Distinct from tribunal deliberations.
   */
  async addAdminNote(user: AuthUser, caseId: string, dto: AddCaseNoteDto) {
    await this.access.assertCanAccessCase(user, caseId);
    this.assertCanAdminister(user);
    const note = dto.note.trim();
    if (!note) throw new BadRequestException('Note cannot be empty.');
    await this.audit.record({
      userId: user.id, action: 'CASE_ADMIN_NOTE', entityType: 'Case', entityId: caseId, caseId,
      metadata: { note, author: user.email },
    });
    return { ok: true };
  }

  /** List the administrative notes recorded for a case (from the audit trail). */
  async listAdminNotes(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    this.assertCanAdminister(user);
    const rows = await this.prisma.auditLog.findMany({
      where: { caseId, action: 'CASE_ADMIN_NOTE' },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => {
      let note = ''; let author = '';
      try { const m = JSON.parse(r.metadata ?? '{}'); note = m.note ?? ''; author = m.author ?? ''; } catch { /* ignore */ }
      return { id: r.id, note, author, at: r.createdAt };
    });
  }
}
