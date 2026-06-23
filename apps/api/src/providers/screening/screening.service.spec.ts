import { ConfigService } from '@nestjs/config';
import { ScreeningService } from './screening.service';

function config(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('ScreeningService — mock driver', () => {
  const service = new ScreeningService(config({ 'screening.driver': 'mock', 'screening.mockBlockTokens': 'BLOCKED,SANCTION,OFAC' }));

  it('clears an ordinary name', async () => {
    const res = await service.screen({ name: 'Acme Trading Ltd', type: 'COMPANY' });
    expect(res.outcome).toBe('CLEAR');
    expect(res.matchCount).toBe(0);
  });

  it('flags a name containing a watchlist token as a possible match', async () => {
    const res = await service.screen({ name: 'Blockedco Holdings', type: 'COMPANY' });
    expect(res.outcome).toBe('POSSIBLE_MATCH');
    expect(res.matchCount).toBe(1);
    expect(res.riskScore).toBeGreaterThan(0);
  });

  it('is always healthy without a network call', async () => {
    await expect(service.healthCheck()).resolves.toBe(true);
  });
});

describe('ScreeningService — http driver', () => {
  const cfg = config({ 'screening.driver': 'http', 'screening.apiUrl': 'https://screen.example/v1', 'screening.apiKey': 'k' });
  afterEach(() => jest.restoreAllMocks());

  it('refuses to construct without url + key', () => {
    expect(() => new ScreeningService(config({ 'screening.driver': 'http' }))).toThrow(/SCREENING_API_URL/);
  });

  it('maps a normalised vendor response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ outcome: 'POSSIBLE_MATCH', riskScore: 70, matchCount: 2, summary: 'PEP hit', reference: 'ref-9' }), { status: 200 }),
    );
    const res = await new ScreeningService(cfg).screen({ name: 'Jane Doe', type: 'INDIVIDUAL' });
    expect(res).toMatchObject({ outcome: 'POSSIBLE_MATCH', matchCount: 2, providerRef: 'ref-9', provider: 'http' });
  });

  it('throws on a provider error (handled as FAILED upstream)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('rate limited', { status: 429 }));
    await expect(new ScreeningService(cfg).screen({ name: 'X', type: 'PARTY' })).rejects.toThrow(/Screening provider failed \(429\)/);
  });

  it('reports unhealthy when unreachable', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(new ScreeningService(cfg).healthCheck()).resolves.toBe(false);
  });
});
