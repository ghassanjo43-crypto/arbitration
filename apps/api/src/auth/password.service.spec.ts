import { ConfigService } from '@nestjs/config';
import { PasswordService } from './password.service';

function makeService(pepper = 'unit-test-pepper'): PasswordService {
  const config = { get: (key: string) => (key === 'security.passwordPepper' ? pepper : undefined) } as ConfigService;
  return new PasswordService(config);
}

describe('PasswordService', () => {
  it('hashes and verifies a correct password', async () => {
    const svc = makeService();
    const hash = await svc.hash('Sup3rSecret!Pass');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await svc.verify(hash, 'Sup3rSecret!Pass')).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const svc = makeService();
    const hash = await svc.hash('Sup3rSecret!Pass');
    expect(await svc.verify(hash, 'wrong-password')).toBe(false);
  });

  it('fails verification when the server pepper differs (defends against DB-only leak)', async () => {
    const a = makeService('pepper-A');
    const hash = await a.hash('Sup3rSecret!Pass');
    const b = makeService('pepper-B');
    expect(await b.verify(hash, 'Sup3rSecret!Pass')).toBe(false);
  });

  it('produces distinct hashes for the same password (random salt)', async () => {
    const svc = makeService();
    const h1 = await svc.hash('repeat');
    const h2 = await svc.hash('repeat');
    expect(h1).not.toEqual(h2);
  });
});
