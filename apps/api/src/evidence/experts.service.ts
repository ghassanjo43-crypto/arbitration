import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExpertAppointment, ExpertReportKind, ExpertStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { AuthUser } from '../auth/types';
import { AddExpertDto, DeclareIndependenceDto, ExpertReportDto } from './dto';

/**
 * Expert evidence (Chapter 14). A party may appoint its own expert; only the
 * tribunal may appoint a tribunal expert. Independence/conflict declarations are
 * recorded before a report is given weight.
 */
@Injectable()
export class ExpertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
  ) {}

  async addExpert(user: AuthUser, caseId: string, dto: AddExpertDto) {
    const m = await this.access.assertCanAccessCase(user, caseId);
    if (dto.appointment === ExpertAppointment.TRIBUNAL_APPOINTED) {
      if (!m.isTribunal) throw new ForbiddenException('Only the tribunal may appoint a tribunal expert.');
    } else if (!m.isParty) {
      throw new ForbiddenException('Only a party may appoint a party expert.');
    }
    const expert = await this.prisma.expert.create({
      data: {
        caseId,
        appointment: dto.appointment,
        partyId: dto.appointment === ExpertAppointment.TRIBUNAL_APPOINTED ? null : dto.partyId,
        fullName: dto.fullName,
        expertise: dto.expertise,
        instructions: dto.instructions,
        feeArrangement: dto.feeArrangement,
        status: dto.appointment === ExpertAppointment.TRIBUNAL_APPOINTED ? ExpertStatus.APPOINTED : ExpertStatus.PROPOSED,
        proposedById: user.id,
      },
    });
    await this.audit.record({ userId: user.id, action: 'EXPERT_ADDED', entityType: 'Expert', entityId: expert.id, caseId, metadata: { appointment: dto.appointment } });
    return expert;
  }

  private async loadExpert(expertId: string) {
    const expert = await this.prisma.expert.findUnique({ where: { id: expertId } });
    if (!expert) throw new NotFoundException('Expert not found.');
    return expert;
  }

  async declareIndependence(user: AuthUser, expertId: string, dto: DeclareIndependenceDto) {
    const expert = await this.loadExpert(expertId);
    await this.access.assertCanAccessCase(user, expert.caseId);
    const updated = await this.prisma.expert.update({
      where: { id: expertId },
      data: { independenceDeclared: dto.independenceDeclared, conflictDisclosed: dto.conflictDisclosed },
    });
    await this.audit.record({ userId: user.id, action: 'EXPERT_INDEPENDENCE_DECLARED', entityType: 'Expert', entityId: expertId, caseId: expert.caseId });
    return updated;
  }

  async submitReport(user: AuthUser, expertId: string, dto: ExpertReportDto) {
    const expert = await this.loadExpert(expertId);
    await this.access.assertCanAccessCase(user, expert.caseId);
    const count = await this.prisma.expertReport.count({ where: { expertId } });
    const report = await this.prisma.expertReport.create({
      data: { expertId, kind: dto.kind ?? ExpertReportKind.REPORT, title: dto.title, documentId: dto.documentId, version: count + 1, submittedById: user.id },
    });
    await this.prisma.expert.update({ where: { id: expertId }, data: { status: ExpertStatus.REPORTED } });
    await this.audit.record({ userId: user.id, action: 'EXPERT_REPORT_FILED', entityType: 'ExpertReport', entityId: report.id, caseId: expert.caseId, metadata: { kind: report.kind } });
    return report;
  }

  async listForCase(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    return this.prisma.expert.findMany({ where: { caseId }, orderBy: { createdAt: 'asc' }, include: { reports: true } });
  }
}
