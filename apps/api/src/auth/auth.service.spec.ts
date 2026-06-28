import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * Registration must succeed once the account row exists — an email-provider
 * failure can only flip `emailSent` to false, never fail the registration.
 */
function setup(opts: {
  existingUser?: Record<string, unknown> | null;
  emailFails?: boolean;
  adminEmail?: string;
  superAdmins?: { user: { email: string } }[];
}) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(opts.existingUser ?? null),
      create: jest.fn().mockResolvedValue({ id: 'new-user-id', email: 'new.user@example.com' }),
    },
    emailToken: {
      create: jest.fn().mockResolvedValue({ id: 'token-id' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    userRole: { findMany: jest.fn().mockResolvedValue(opts.superAdmins ?? []) },
  };
  const passwords = { hash: jest.fn().mockResolvedValue('hashed-password') };
  const email = {
    send: opts.emailFails
      ? jest.fn().mockRejectedValue(new Error('provider rejected the message'))
      : jest.fn().mockResolvedValue(undefined),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const config = {
    get: jest.fn((k: string) =>
      k === 'publicWebUrl' ? 'http://localhost:5173' : k === 'email.adminNotificationEmail' ? opts.adminEmail : undefined,
    ),
  };
  const tokens = {};

  const service = new AuthService(
    prisma as never,
    passwords as never,
    tokens as never,
    email as never,
    audit as never,
    config as never,
  );
  return { service, prisma, passwords, email, audit };
}

const dto = {
  email: 'New.User@Example.com',
  password: 'a-sufficiently-long-password',
  firstName: 'New',
  lastName: 'User',
  acceptTerms: true,
  acceptPrivacy: true,
} as never;

describe('AuthService.register', () => {
  it('successful registration with a successful email → { registered, emailSent: true }', async () => {
    const { service, prisma, email } = setup({});
    const result = await service.register(dto, {});
    expect(result).toEqual({ registered: true, emailSent: true });
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(prisma.emailToken.create).toHaveBeenCalledTimes(1);
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it('successful registration but a failed email → { registered, emailSent: false } and does not throw', async () => {
    const { service, prisma } = setup({ emailFails: true });
    const result = await service.register(dto, {});
    expect(result).toEqual({ registered: true, emailSent: false });
    // The account and token are still persisted.
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(prisma.emailToken.create).toHaveBeenCalledTimes(1);
  });

  it('existing PENDING_VERIFICATION account → generic success, re-issues verification, no new user', async () => {
    const { service, prisma, email } = setup({
      existingUser: { id: 'u1', email: 'new.user@example.com', emailVerified: false, status: 'PENDING_VERIFICATION', deletedAt: null },
    });
    const result = await service.register(dto, {});
    expect(result).toEqual({ registered: true, emailSent: true });
    expect(prisma.user.create).not.toHaveBeenCalled();
    // Prior tokens expired, a fresh one issued, email re-sent.
    expect(prisma.emailToken.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.emailToken.create).toHaveBeenCalledTimes(1);
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it('notifies the configured admin email when a new account is registered', async () => {
    const { service, email } = setup({ adminEmail: 'owner@panel.example' });
    await service.register(dto, {});
    // Verification email to the user + notification to the admin.
    expect(email.send).toHaveBeenCalledTimes(2);
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'owner@panel.example', subject: expect.stringContaining('New registration') }),
    );
  });

  it('falls back to notifying active super-administrators when no admin email is configured', async () => {
    const { service, email } = setup({ superAdmins: [{ user: { email: 'super@panel.example' } }] });
    await service.register(dto, {});
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'super@panel.example' }));
  });

  it('existing ACTIVE account → blocked with a generic BadRequest, no new user', async () => {
    const { service, prisma } = setup({
      existingUser: { id: 'u2', email: 'new.user@example.com', emailVerified: true, status: 'ACTIVE', deletedAt: null },
    });
    await expect(service.register(dto, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

describe('AuthService.requestPasswordReset', () => {
  it('emails a reset link that points at the frontend /reset-password route', async () => {
    const { service, email } = setup({ existingUser: { id: 'u1', email: 'user@example.com', emailVerified: true, status: 'ACTIVE', deletedAt: null } });
    await service.requestPasswordReset('user@example.com');
    expect(email.send).toHaveBeenCalledTimes(1);
    const msg = email.send.mock.calls[0][0];
    expect(msg.text).toContain('http://localhost:5173/reset-password?token=');
  });
});
