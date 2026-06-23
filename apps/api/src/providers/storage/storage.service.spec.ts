import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { StorageService } from './storage.service';

/**
 * Local-driver behaviour and the driver-agnostic signed-token logic. The S3
 * driver is exercised against a live/mock bucket in integration, not here.
 */
describe('StorageService (local driver)', () => {
  let service: StorageService;
  const root = join(tmpdir(), `gaap-storage-test-${Date.now()}`);

  const config = {
    get: (key: string) => {
      switch (key) {
        case 'storage.driver':
          return 'local';
        case 'storage.localRoot':
          return root;
        case 'storage.signedUrlTtl':
          return 600;
        case 'security.cookieSecret':
          return 'test-secret';
        default:
          return undefined;
      }
    },
  } as unknown as ConfigService;

  beforeAll(() => {
    service = new StorageService(config);
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('stores bytes and returns a correct SHA-256 hash and size', async () => {
    const buffer = Buffer.from('confidential exhibit A');
    const stored = await service.put(buffer, 'Exhibit A.pdf');

    expect(stored.fileSize).toBe(buffer.length);
    expect(stored.fileHash).toBe(createHash('sha256').update(buffer).digest('hex'));
    // Key is namespaced by year, randomised, and the unsafe filename sanitised.
    expect(stored.storageKey).toMatch(/^\d{4}\/[0-9a-f-]+-Exhibit_A\.pdf$/);
  });

  it('round-trips the exact bytes back out', async () => {
    const buffer = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
    const stored = await service.put(buffer, 'binary.bin');
    const out = await service.get(stored.storageKey);
    expect(out.equals(buffer)).toBe(true);
  });

  it('local driver is always healthy', async () => {
    await expect(service.healthCheck()).resolves.toBe(true);
  });

  it('verifies its own freshly-signed download token', () => {
    const { token } = service.signDownload('2026/some-key.pdf');
    expect(service.verifyDownload('2026/some-key.pdf', token)).toBe(true);
  });

  it('rejects a token for a different key (no cross-object reuse)', () => {
    const { token } = service.signDownload('2026/key-one.pdf');
    expect(service.verifyDownload('2026/key-two.pdf', token)).toBe(false);
  });

  it('rejects a tampered or malformed token', () => {
    expect(service.verifyDownload('2026/k.pdf', 'garbage')).toBe(false);
    const { token } = service.signDownload('2026/k.pdf');
    const [sig] = token.split('.');
    // Expired timestamp.
    expect(service.verifyDownload('2026/k.pdf', `${sig}.1`)).toBe(false);
  });
});
