import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JoinderStatus } from '@prisma/client';
import { Permission } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { AuthUser } from '../auth/types';
import { DecideJoinderDto, JoinderCommentDto, JoinderRequestDto } from './dto';

/**
 * Multi-party & multi-contract (Chapter 24): consolidation and joinder.
 *
 * The portal records the request, party comments and the decision. The TRIBUNAL
 * or the appointing authority decides — never the portal on its own.
 */
@Injectable()
export class MultiPartyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
  ) {}

  async request(user: AuthUser, caseId: string, dto: JoinderRequestDto) {
    const m = await this.access.assertCanAccessCase(user, caseId);
    if (!m.isParty) throw new ForbiddenException('Only a party may request consolidation or joinder.');
    const count = await this.prisma.partyJoinderRequest.count({ where: { caseId } });
    const request = await this.prisma.partyJoinderRequest.create({
      data: {
        caseId,
        type: dto.type,
        requestNumber: `J-${String(count + 1).padStart(4, '0')}`,
        subjectDescription: dto.subjectDescription,
        relatedCaseRef: dto.relatedCaseRef,
        requestingPartyId: dto.requestingPartyId,
        grounds: dto.grounds,
        requestedById: user.id,
      },
    });
    await this.audit.record({ userId: user.id, action: 'JOINDER_REQUESTED', entityType: 'PartyJoinderRequest', entityId: request.id, caseId, metadata: { type: dto.type } });
    return request;
  }

  private async load(requestId: string) {
    const request = await this.prisma.partyJoinderRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Joinder/consolidation request not found.');
    return request;
  }

  /** A party comments on a pending request. */
  async comment(user: AuthUser, requestId: string, dto: JoinderCommentDto) {
    const request = await this.load(requestId);
    const m = await this.access.assertCanAccessCase(user, request.caseId);
    if (!m.isParty) throw new ForbiddenException('Only a party may comment on a joinder/consolidation request.');
    const comment = await this.prisma.joinderComment.create({
      data: { requestId, authorById: user.id, partyId: dto.partyId, comment: dto.comment },
    });
    if (request.status === JoinderStatus.REQUESTED) {
      await this.prisma.partyJoinderRequest.update({ where: { id: requestId }, data: { status: JoinderStatus.COMMENTS_OPEN } });
    }
    await this.audit.record({ userId: user.id, action: 'JOINDER_COMMENTED', entityType: 'PartyJoinderRequest', entityId: requestId, caseId: request.caseId });
    return comment;
  }

  /**
   * The tribunal or the appointing authority decides. Parties cannot decide
   * their own request.
   */
  async decide(user: AuthUser, requestId: string, dto: DecideJoinderDto) {
    const request = await this.load(requestId);
    const m = await this.access.assertCanAccessCase(user, request.caseId);
    const isAppointingAuthority = m.isRegistrar || user.permissions.includes(Permission.CASE_REGISTER);
    if (!m.isTribunal && !isAppointingAuthority) {
      throw new ForbiddenException('Only the tribunal or the appointing authority may decide a joinder/consolidation request.');
    }
    if (request.decidedAt) throw new BadRequestException('This request has already been decided.');

    const updated = await this.prisma.partyJoinderRequest.update({
      where: { id: requestId },
      data: {
        status: dto.grant ? JoinderStatus.GRANTED : JoinderStatus.DENIED,
        decision: dto.grant ? 'GRANTED' : 'DENIED',
        decisionReason: dto.reason,
        decidedById: user.id,
        decidedAt: new Date(),
        feeReallocationNote: dto.feeReallocationNote,
      },
    });
    await this.audit.record({ userId: user.id, action: 'JOINDER_DECIDED', entityType: 'PartyJoinderRequest', entityId: requestId, caseId: request.caseId, metadata: { grant: dto.grant } });
    return updated;
  }

  async withdraw(user: AuthUser, requestId: string) {
    const request = await this.load(requestId);
    await this.access.assertCanAccessCase(user, request.caseId);
    if (request.requestedById !== user.id) throw new ForbiddenException('Only the requesting party may withdraw the request.');
    if (request.decidedAt) throw new BadRequestException('A decided request cannot be withdrawn.');
    const updated = await this.prisma.partyJoinderRequest.update({ where: { id: requestId }, data: { status: JoinderStatus.WITHDRAWN } });
    await this.audit.record({ userId: user.id, action: 'JOINDER_WITHDRAWN', entityType: 'PartyJoinderRequest', entityId: requestId, caseId: request.caseId });
    return updated;
  }

  async listForCase(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    return this.prisma.partyJoinderRequest.findMany({
      where: { caseId },
      orderBy: { requestNumber: 'asc' },
      include: { comments: { orderBy: { createdAt: 'asc' } } },
    });
  }
}
