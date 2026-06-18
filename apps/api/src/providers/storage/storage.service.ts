import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID, createHmac } from 'crypto';
import { promises as fs } from 'fs';
import { join, resolve, dirname } from 'path';

export interface StoredObject {
  storageKey: string;
  fileHash: string;
  fileSize: number;
}

/**
 * Object storage abstraction. The local adapter writes to a directory OUTSIDE
 * the public web root (STORAGE_LOCAL_ROOT). Confidential files are never served
 * statically — access is brokered through signed, time-limited URLs verified by
 * the API. Swap STORAGE_DRIVER=s3 to use an S3-compatible backend later.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: string;
  private readonly root: string;
  private readonly signedUrlTtl: number;
  private readonly signingSecret: string;

  constructor(config: ConfigService) {
    this.driver = config.get<string>('storage.driver') ?? 'local';
    this.root = resolve(config.get<string>('storage.localRoot') ?? './storage');
    this.signedUrlTtl = config.get<number>('storage.signedUrlTtl') ?? 600;
    this.signingSecret = config.get<string>('security.cookieSecret') ?? 'dev-sign';
  }

  async put(buffer: Buffer, originalName: string): Promise<StoredObject> {
    const fileHash = createHash('sha256').update(buffer).digest('hex');
    const storageKey = `${new Date().getFullYear()}/${randomUUID()}-${this.sanitise(originalName)}`;

    if (this.driver === 'local') {
      const fullPath = join(this.root, storageKey);
      await fs.mkdir(dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, buffer);
    } else {
      this.logger.warn(`Storage driver "${this.driver}" not implemented; using no-op.`);
    }
    return { storageKey, fileHash, fileSize: buffer.length };
  }

  async get(storageKey: string): Promise<Buffer> {
    if (this.driver === 'local') {
      return fs.readFile(join(this.root, storageKey));
    }
    throw new Error(`Storage driver "${this.driver}" not implemented.`);
  }

  /** Issues a short-lived signed token. The API verifies before streaming. */
  signDownload(storageKey: string): { token: string; expiresAt: number } {
    const expiresAt = Math.floor(Date.now() / 1000) + this.signedUrlTtl;
    const token = this.sign(`${storageKey}:${expiresAt}`);
    return { token: `${token}.${expiresAt}`, expiresAt };
  }

  verifyDownload(storageKey: string, token: string): boolean {
    const [sig, expStr] = token.split('.');
    const exp = parseInt(expStr ?? '0', 10);
    if (!sig || !exp || exp < Math.floor(Date.now() / 1000)) return false;
    const expected = this.sign(`${storageKey}:${exp}`);
    return sig === expected;
  }

  private sign(value: string): string {
    return createHmac('sha256', this.signingSecret).update(value).digest('hex');
  }

  private sanitise(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  }
}
