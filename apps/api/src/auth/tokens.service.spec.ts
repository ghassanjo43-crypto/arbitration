import { TokensService } from './tokens.service';

function make() {
  const prisma = { session: { findUnique: jest.fn(), update: jest.fn() } };
  const svc = new TokensService({} as never, { get: () => 900 } as never, prisma as never);
  return { svc, prisma };
}

describe('TokensService.rotate — hardening', () => {
  it.each([undefined, null, '', 'no-dot-token'])(
    'returns null (no DB call, no throw) for missing/malformed token: %p',
    async (value) => {
      const { svc, prisma } = make();
      await expect(svc.rotate(value as never)).resolves.toBeNull();
      expect(prisma.session.findUnique).not.toHaveBeenCalled();
    },
  );

  it('returns null when the session id or secret half is empty', async () => {
    const { svc } = make();
    expect(await svc.rotate('sessiononly.')).toBeNull();
    expect(await svc.rotate('.secretonly')).toBeNull();
  });

  it('never calls .split() on a non-string (does not throw)', async () => {
    const { svc } = make();
    await expect(svc.rotate(undefined)).resolves.toBeNull();
    await expect(svc.rotate(null)).resolves.toBeNull();
  });
});
