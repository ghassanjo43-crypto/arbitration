import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseRole, MessageCategory, NotificationType } from '@prisma/client';
import { Permission } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { AuthUser } from '../auth/types';
import { SendMessageDto } from './dto';

const STAFF_CASE_ROLES: CaseRole[] = [CaseRole.CASE_REGISTRAR, CaseRole.TRIBUNAL_SECRETARY];
const TRIBUNAL_DECIDING_ROLES: CaseRole[] = [CaseRole.TRIBUNAL_CHAIR, CaseRole.TRIBUNAL_MEMBER];

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
  ) {}

  async send(user: AuthUser, caseId: string, dto: SendMessageDto) {
    const membership = await this.access.assertCanAccessCase(user, caseId);
    const isStaff = membership.isRegistrar || user.permissions.includes(Permission.CASE_VIEW_QUEUE);

    // Ex-parte guard: ADMIN_PRIVATE is reserved for institutional staff. Any
    // substantive message from a party is delivered to ALL authorised case
    // participants — a party cannot privately address the tribunal.
    const restricted = dto.category === MessageCategory.ADMIN_PRIVATE;
    if (restricted && !isStaff) {
      throw new ForbiddenException('Private administrative messages may only be sent by the registry.');
    }

    const team = await this.prisma.caseTeamMember.findMany({ where: { caseId, active: true } });
    let recipientIds: string[];
    if (restricted) {
      // Administrative side-channel: staff + tribunal only (never parties).
      recipientIds = team
        .filter((m) => STAFF_CASE_ROLES.includes(m.caseRole) || TRIBUNAL_DECIDING_ROLES.includes(m.caseRole))
        .map((m) => m.userId);
    } else {
      // Everyone on the case (transparency / no ex-parte contact).
      recipientIds = team.map((m) => m.userId);
    }
    recipientIds = [...new Set(recipientIds)].filter((id) => id !== user.id);

    const message = await this.prisma.caseMessage.create({
      data: {
        caseId,
        senderId: user.id,
        category: dto.category,
        subject: dto.subject,
        body: dto.body,
        restricted,
        recipients: { create: recipientIds.map((userId) => ({ userId, deliveredAt: new Date() })) },
      },
    });

    if (recipientIds.length) {
      await this.prisma.notification.createMany({
        data: recipientIds.map((userId) => ({
          userId,
          type: NotificationType.MESSAGE,
          title: `New ${dto.category.replace('_', ' ').toLowerCase()} message`,
          body: dto.subject,
          link: `/app/cases/${caseId}`,
        })),
      });
    }

    await this.audit.record({ userId: user.id, action: 'MESSAGE_SENT', entityType: 'CaseMessage', entityId: message.id, caseId, metadata: { category: dto.category, restricted, recipients: recipientIds.length } });
    return message;
  }

  /** Messages the user may see: ones they sent or are a recipient of. */
  async listForCase(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    return this.prisma.caseMessage.findMany({
      where: { caseId, OR: [{ senderId: user.id }, { recipients: { some: { userId: user.id } } }] },
      include: {
        sender: { select: { email: true, profile: { select: { displayName: true } } } },
        recipients: { where: { userId: user.id }, select: { readAt: true, deliveredAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markRead(user: AuthUser, messageId: string) {
    const recipient = await this.prisma.messageRecipient.findFirst({ where: { messageId, userId: user.id } });
    if (!recipient) throw new NotFoundException('Message not found.');
    if (!recipient.readAt) {
      await this.prisma.messageRecipient.update({ where: { id: recipient.id }, data: { readAt: new Date() } });
    }
    return { read: true };
  }
}
