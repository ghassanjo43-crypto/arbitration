import { ReadinessService } from './readiness.service';

function make(over: { db?: boolean; migrations?: { applied: number; unfinished: number } | null; storage?: boolean; video?: boolean; screening?: boolean; email?: boolean } = {}) {
  const prisma = {
    $queryRaw: jest.fn().mockImplementation((strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join('') : String(strings);
      if (sql.includes('_prisma_migrations')) {
        if (over.migrations === null) return Promise.reject(new Error('no table'));
        const m = over.migrations ?? { applied: 17, unfinished: 0 };
        return Promise.resolve([{ applied: BigInt(m.applied), unfinished: BigInt(m.unfinished) }]);
      }
      if (over.db === false) return Promise.reject(new Error('db down'));
      return Promise.resolve([{ '?column?': 1 }]);
    }),
  };
  const storage = { healthCheck: jest.fn().mockResolvedValue(over.storage ?? true) };
  const video = { healthCheck: jest.fn().mockResolvedValue(over.video ?? true) };
  const screening = { healthCheck: jest.fn().mockResolvedValue(over.screening ?? true) };
  const email = { healthCheck: jest.fn().mockReturnValue(over.email ?? true) };
  const service = new ReadinessService(prisma as never, storage as never, video as never, screening as never, email as never);
  return { service };
}

describe('ReadinessService', () => {
  it('reports ready when every dependency is up', async () => {
    const { service } = make();
    const res = await service.check();
    expect(res.status).toBe('ready');
    expect(res.checks).toEqual({ db: 'up', migrations: 'up', storage: 'up', video: 'up', email: 'up', screening: 'up' });
  });

  it('is not_ready when the database is down', async () => {
    const { service } = make({ db: false, migrations: null });
    const res = await service.check();
    expect(res.status).toBe('not_ready');
    expect(res.checks.db).toBe('down');
  });

  it('is not_ready when a provider (storage) is down', async () => {
    const { service } = make({ storage: false });
    const res = await service.check();
    expect(res.status).toBe('not_ready');
    expect(res.checks.storage).toBe('down');
  });

  it('is not_ready when email config is unusable', async () => {
    const { service } = make({ email: false });
    const res = await service.check();
    expect(res.status).toBe('not_ready');
    expect(res.checks.email).toBe('down');
  });

  it('flags migrations down when a migration is unfinished', async () => {
    const { service } = make({ migrations: { applied: 16, unfinished: 1 } });
    const res = await service.check();
    expect(res.checks.migrations).toBe('down');
    expect(res.status).toBe('not_ready');
  });
});
