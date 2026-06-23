import { NotificationsService } from './notifications.service';
import { NOTIFICATION_TEMPLATES, NotificationTemplateKey, interpolate } from './notification-templates';

const KEYS = Object.keys(NOTIFICATION_TEMPLATES) as NotificationTemplateKey[];

describe('notification templates', () => {
  it('defines EN and AR subject + body for every template key', () => {
    for (const key of KEYS) {
      const t = NOTIFICATION_TEMPLATES[key];
      expect(t.en.subject.trim()).not.toBe('');
      expect(t.en.body.trim()).not.toBe('');
      expect(t.ar.subject.trim()).not.toBe('');
      expect(t.ar.body.trim()).not.toBe('');
    }
  });

  it('covers the full spec notification set', () => {
    // 20 base events + 6 appointment-hardening events (reminders, default
    // appointment, chair nomination, vacancy, replacement, challenge decided).
    expect(KEYS).toHaveLength(26);
    expect(KEYS).toEqual(expect.arrayContaining([
      'FILING_SUBMITTED', 'DEFICIENCY_NOTICE', 'CASE_REGISTERED', 'NOTICE_ISSUED', 'RESPONSE_DUE',
      'DEADLINE_REMINDER', 'DEADLINE_OVERDUE', 'APPOINTMENT_INVITATION', 'CONFLICT_DISCLOSURE', 'CHALLENGE',
      'TRIBUNAL_CONSTITUTED', 'PROCEDURAL_CONFERENCE', 'FILING_RECEIVED', 'HEARING_SCHEDULED', 'PAYMENT_REQUESTED',
      'PAYMENT_OVERDUE', 'SUBSTITUTE_PAYMENT_OPPORTUNITY', 'ORDER_ISSUED', 'AWARD_ISSUED', 'CORRECTION_DEADLINE',
      'APPOINTMENT_REMINDER', 'DEFAULT_APPOINTMENT', 'CHAIR_NOMINATION', 'TRIBUNAL_VACANCY',
      'ARBITRATOR_REPLACEMENT', 'CHALLENGE_DECIDED',
    ]));
  });

  it('interpolates {{vars}} and leaves unknown placeholders empty', () => {
    expect(interpolate('Case {{caseRef}} due {{dueDate}}', { caseRef: 'GAAP-1', dueDate: '2026-07-01' })).toBe('Case GAAP-1 due 2026-07-01');
    expect(interpolate('Hello {{missing}}!', {})).toBe('Hello !');
  });
});

describe('NotificationsService', () => {
  function make(preferredLanguage = 'en') {
    const created: Record<string, unknown>[] = [];
    const prisma = {
      userProfile: { findUnique: jest.fn().mockResolvedValue({ preferredLanguage }) },
      notification: { create: jest.fn(({ data }) => (created.push(data), { id: 'n1', ...data })) },
    };
    const email = { send: jest.fn().mockResolvedValue(undefined) };
    return { service: new NotificationsService(prisma as never, email as never), prisma, email, created };
  }

  it('renders Arabic when requested and English by default', () => {
    const { service } = make();
    const en = service.render('AWARD_ISSUED', 'en', { caseRef: 'GAAP-1' });
    const ar = service.render('AWARD_ISSUED', 'ar', { caseRef: 'GAAP-1' });
    expect(en.subject).toContain('Award issued');
    expect(ar.subject).toContain('صدور حكم');
    expect(en.subject).toContain('GAAP-1');
  });

  it('notify persists an in-platform notification in the user\'s preferred language', async () => {
    const { service, created } = make('ar');
    await service.notify({ userId: 'u1', key: 'CASE_REGISTERED', vars: { caseRef: 'GAAP-2' } });
    expect(created[0].title).toContain('تم تسجيل القضية');
    expect(created[0].type).toBe('CASE_UPDATE');
  });

  it('notifyCaseMembers fans out to each active member except the excluded actor', async () => {
    const created: Record<string, unknown>[] = [];
    const prisma = {
      caseTeamMember: {
        findMany: jest.fn().mockResolvedValue([
          { userId: 'u1', user: { email: 'a@x.com', profile: { preferredLanguage: 'en' } } },
          { userId: 'u2', user: { email: 'b@x.com', profile: { preferredLanguage: 'ar' } } },
          { userId: 'actor', user: { email: 'c@x.com', profile: { preferredLanguage: 'en' } } },
          { userId: 'u1', user: { email: 'a@x.com', profile: { preferredLanguage: 'en' } } }, // duplicate role row
        ]),
      },
      userProfile: { findUnique: jest.fn() },
      notification: { create: jest.fn(({ data }) => (created.push(data), { id: 'n', ...data })) },
    };
    const email = { send: jest.fn().mockResolvedValue(undefined) };
    const service = new NotificationsService(prisma as never, email as never);
    await service.notifyCaseMembers({ caseId: 'c1', key: 'FILING_RECEIVED', vars: { caseRef: 'GAAP-9', filingType: 'Statement of Claim' }, excludeUserId: 'actor' });
    // u1 (once, deduped) + u2 — actor excluded.
    expect(created).toHaveLength(2);
    const ar = created.find((c) => c.userId === 'u2');
    expect(ar?.title).toContain('تم استلام إيداع');
  });

  it('dispatch creates the notification and sends the email; an email failure does not block it', async () => {
    const { service, email, created } = make('en');
    await service.dispatch({ userId: 'u1', to: 'p@x.com', key: 'PAYMENT_REQUESTED', vars: { caseRef: 'GAAP-3', amount: 1000, currency: 'USD', dueDate: '2026-07-01' } });
    expect(created).toHaveLength(1);
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'p@x.com' }));

    email.send.mockRejectedValueOnce(new Error('smtp down'));
    const res = await service.dispatch({ userId: 'u1', to: 'p@x.com', key: 'PAYMENT_OVERDUE', vars: { caseRef: 'GAAP-3' } });
    expect(res.id).toBe('n1'); // still created despite email failure
  });
});
