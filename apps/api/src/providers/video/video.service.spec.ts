import { ConfigService } from '@nestjs/config';
import { VideoService } from './video.service';

function config(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('VideoService — placeholder driver', () => {
  const service = new VideoService(config({ 'video.driver': 'placeholder' }));

  it('reports its provider name', () => {
    expect(service.providerName).toBe('placeholder');
  });

  it('creates a deterministic mock room', async () => {
    const room = await service.createRoom('Main hearing room');
    expect(room.provider).toBe('placeholder');
    expect(room.joinUrl).toContain(room.externalRoomId);
  });

  it('issues distinct owner vs guest join links', async () => {
    const base = 'https://hearings.local/placeholder/abc?room=Main';
    const owner = await service.issueJoinUrl(base, { owner: true });
    const guest = await service.issueJoinUrl(base, { owner: false });
    expect(owner).toContain('mock-owner-');
    expect(guest).toContain('mock-guest-');
  });

  it('is always healthy and never calls a network', async () => {
    await expect(service.healthCheck()).resolves.toBe(true);
  });
});

describe('VideoService — daily driver', () => {
  const cfg = config({
    'video.driver': 'daily',
    'video.daily.apiKey': 'test-key',
    'video.daily.apiUrl': 'https://api.daily.co/v1',
  });

  afterEach(() => jest.restoreAllMocks());

  it('refuses to construct without an API key', () => {
    expect(() => new VideoService(config({ 'video.driver': 'daily' }))).toThrow(/DAILY_API_KEY/);
  });

  it('creates a private room via the REST API', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ name: 'room-xyz', url: 'https://co.daily.co/room-xyz' }), { status: 200 }),
      );
    const service = new VideoService(cfg);
    const room = await service.createRoom('Tribunal private room', 1893456000);

    expect(room).toEqual({ provider: 'daily', externalRoomId: 'room-xyz', joinUrl: 'https://co.daily.co/room-xyz' });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init!.body as string).privacy).toBe('private');
  });

  it('mints an owner meeting token and appends it to the room URL', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ token: 'tok-123' }), { status: 200 }));
    const service = new VideoService(cfg);
    const url = await service.issueJoinUrl('https://co.daily.co/room-xyz', { owner: true, userName: 'a@x.com' });
    expect(url).toBe('https://co.daily.co/room-xyz?t=tok-123');
  });

  it('throws (does not silently fail) when the provider rejects room creation', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('quota exceeded', { status: 429 }));
    const service = new VideoService(cfg);
    await expect(service.createRoom('x')).rejects.toThrow(/Daily room creation failed \(429\)/);
  });

  it('reports unhealthy when the provider is unreachable', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const service = new VideoService(cfg);
    await expect(service.healthCheck()).resolves.toBe(false);
  });
});
