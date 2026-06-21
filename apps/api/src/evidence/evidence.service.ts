import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EvidenceObjectionStatus,
  OathKind,
  WitnessStatus,
} from '@prisma/client';
import { Permission } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { AuthUser } from '../auth/types';
import {
  AddWitnessDto,
  RaiseObjectionDto,
  RecordOathDto,
  RuleObjectionDto,
  WitnessStatementDto,
} from './dto';

/**
 * Witness evidence (Chapter 13) and evidence objections (Chapters 11/13/14).
 * The portal records witnesses, statements and objections; the TRIBUNAL rules
 * on admissibility and weight.
 */
@Injectable()
export class EvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
  ) {}

  // ---- Witnesses ----------------------------------------------------------

  async addWitness(user: AuthUser, caseId: string, dto: AddWitnessDto) {
    const m = await this.access.assertCanAccessCase(user, caseId);
    if (!m.isParty) throw new ForbiddenException('Only a party may put forward a witness.');
    const witness = await this.prisma.witness.create({
      data: {
        caseId,
        partyId: dto.partyId,
        fullName: dto.fullName,
        capacity: dto.capacity,
        language: dto.language ?? 'en',
        interpreterRequired: dto.interpreterRequired ?? false,
        availabilityNote: dto.availabilityNote,
        crossExaminationRequired: dto.crossExaminationRequired ?? false,
        proposedById: user.id,
      },
    });
    await this.audit.record({ userId: user.id, action: 'WITNESS_ADDED', entityType: 'Witness', entityId: witness.id, caseId, metadata: { fullName: dto.fullName } });
    return witness;
  }

  private async loadWitness(witnessId: string) {
    const witness = await this.prisma.witness.findUnique({ where: { id: witnessId } });
    if (!witness) throw new NotFoundException('Witness not found.');
    return witness;
  }

  async submitStatement(user: AuthUser, witnessId: string, dto: WitnessStatementDto) {
    const witness = await this.loadWitness(witnessId);
    const m = await this.access.assertCanAccessCase(user, witness.caseId);
    if (!m.isParty) throw new ForbiddenException('Only a party may file a witness statement.');
    const count = await this.prisma.witnessStatement.count({ where: { witnessId } });
    const statement = await this.prisma.witnessStatement.create({
      data: { witnessId, title: dto.title, language: dto.language ?? witness.language, documentId: dto.documentId, version: count + 1, submittedById: user.id },
    });
    await this.audit.record({ userId: user.id, action: 'WITNESS_STATEMENT_FILED', entityType: 'WitnessStatement', entityId: statement.id, caseId: witness.caseId });
    return statement;
  }

  /** Registrar verifies the witness's identity (a hearing pre-condition). */
  async verifyIdentity(user: AuthUser, witnessId: string) {
    const witness = await this.loadWitness(witnessId);
    const m = await this.access.assertCanAccessCase(user, witness.caseId);
    if (!m.isRegistrar && !m.isTribunal && !user.permissions.includes(Permission.CASE_MANAGE_SERVICE)) {
      throw new ForbiddenException('Only the registry or the tribunal may verify witness identity.');
    }
    const updated = await this.prisma.witness.update({ where: { id: witnessId }, data: { identityVerified: true } });
    await this.audit.record({ userId: user.id, action: 'WITNESS_IDENTITY_VERIFIED', entityType: 'Witness', entityId: witnessId, caseId: witness.caseId });
    return updated;
  }

  /** The witness/party accepts the witness-isolation protocol. */
  async acknowledgeIsolation(user: AuthUser, witnessId: string) {
    const witness = await this.loadWitness(witnessId);
    await this.access.assertCanAccessCase(user, witness.caseId);
    const updated = await this.prisma.witness.update({ where: { id: witnessId }, data: { isolationAcknowledged: true } });
    await this.audit.record({ userId: user.id, action: 'WITNESS_ISOLATION_ACKNOWLEDGED', entityType: 'Witness', entityId: witnessId, caseId: witness.caseId });
    return updated;
  }

  /** The tribunal/registrar records the oath or affirmation taken at the hearing. */
  async recordOath(user: AuthUser, witnessId: string, dto: RecordOathDto) {
    const witness = await this.loadWitness(witnessId);
    const m = await this.access.assertCanAccessCase(user, witness.caseId);
    if (!m.isTribunal && !m.isRegistrar) {
      throw new ForbiddenException('Only the tribunal or the registry may record an oath/affirmation.');
    }
    const updated = await this.prisma.witness.update({
      where: { id: witnessId },
      data: {
        oath: dto.oath,
        oathRecordedAt: dto.oath === OathKind.NONE ? null : new Date(),
        hearingAttendance: dto.hearingAttendance,
        status: dto.oath === OathKind.NONE ? witness.status : WitnessStatus.TESTIFIED,
      },
    });
    await this.audit.record({ userId: user.id, action: 'WITNESS_OATH_RECORDED', entityType: 'Witness', entityId: witnessId, caseId: witness.caseId, metadata: { oath: dto.oath } });
    return updated;
  }

  async listWitnesses(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    return this.prisma.witness.findMany({ where: { caseId }, orderBy: { createdAt: 'asc' }, include: { statements: true } });
  }

  // ---- Evidence objections ------------------------------------------------

  async raiseObjection(user: AuthUser, caseId: string, dto: RaiseObjectionDto) {
    const m = await this.access.assertCanAccessCase(user, caseId);
    if (!m.isParty) throw new ForbiddenException('Only a party may object to evidence.');
    const objection = await this.prisma.evidenceObjection.create({
      data: { caseId, targetType: dto.targetType, targetId: dto.targetId, ground: dto.ground, detail: dto.detail, raisedById: user.id },
    });
    await this.audit.record({ userId: user.id, action: 'EVIDENCE_OBJECTION_RAISED', entityType: 'EvidenceObjection', entityId: objection.id, caseId, metadata: { targetType: dto.targetType, ground: dto.ground } });
    return objection;
  }

  /** The TRIBUNAL rules on an objection. Parties cannot rule on their own. */
  async ruleObjection(user: AuthUser, objectionId: string, dto: RuleObjectionDto) {
    const objection = await this.prisma.evidenceObjection.findUnique({ where: { id: objectionId } });
    if (!objection) throw new NotFoundException('Objection not found.');
    const m = await this.access.assertCanAccessCase(user, objection.caseId);
    if (!m.isTribunal) throw new ForbiddenException('Only the tribunal may rule on an evidence objection.');
    if (dto.status === EvidenceObjectionStatus.RAISED) {
      throw new BadRequestException('A ruling must be UPHELD, DISMISSED or DEFERRED.');
    }
    const updated = await this.prisma.evidenceObjection.update({
      where: { id: objectionId },
      data: { status: dto.status, ruling: dto.ruling, ruledById: user.id, ruledAt: new Date() },
    });
    await this.audit.record({ userId: user.id, action: 'EVIDENCE_OBJECTION_RULED', entityType: 'EvidenceObjection', entityId: objectionId, caseId: objection.caseId, metadata: { status: dto.status } });
    return updated;
  }

  async listObjections(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    return this.prisma.evidenceObjection.findMany({ where: { caseId }, orderBy: { createdAt: 'asc' } });
  }
}
