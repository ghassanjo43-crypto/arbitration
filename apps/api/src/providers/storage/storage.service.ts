import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID, createHmac } from 'crypto';
import { promises as fs } from 'fs';
import { join, resolve, dirname } from 'path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';

export interface StoredObject {
  storageKey: string;
  fileHash: string;
  fileSize: number;
}

/**
 * Object storage abstraction. Two production-capable drivers:
 *
 *  - `local`: writes to a directory OUTSIDE the public web root (STORAGE_LOCAL_ROOT).
 *    Suitable for development and single-node deployments.
 *  - `s3`: an S3-compatible backend (AWS S3, Cloudflare R2, MinIO, Backblaze B2).
 *    Server-side encryption is requested on every upload.
 *
 * Confidential files are NEVER served statically and NEVER handed to the client as
 * a raw provider URL: every download is brokered by the API, which re-checks
 * access and records activity, then streams the bytes. The signed token below is
 * the short-lived capability the API's own download endpoint verifies — it is
 * driver-agnostic on purpose, so swapping the backend never changes the auth path.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: string;
  private readonly root: string;
  private readonly signedUrlTtl: number;
  private readonly signingSecret: string;

  // S3 driver state (only initialised when driver === 's3').
  private readonly s3?: S3Client;
  private readonly bucket: string;
  private readonly sse: string;

  constructor(config: ConfigService) {
    this.driver = config.get<string>('storage.driver') ?? 'local';
    this.root = resolve(config.get<string>('storage.localRoot') ?? './storage');
    this.signedUrlTtl = config.get<number>('storage.signedUrlTtl') ?? 600;
    this.signingSecret = config.get<string>('security.cookieSecret') ?? 'dev-sign';
    this.bucket = config.get<string>('storage.s3.bucket') ?? '';
    this.sse = config.get<string>('storage.s3.serverSideEncryption') ?? 'AES256';

    if (this.driver === 's3') {
      const region = config.get<string>('storage.s3.region') ?? 'us-east-1';
      const endpoint = config.get<string>('storage.s3.endpoint');
      const accessKeyId = config.get<string>('storage.s3.accessKeyId');
      const secretAccessKey = config.get<string>('storage.s3.secretAccessKey');
      const forcePathStyle = config.get<boolean>('storage.s3.forcePathStyle') ?? false;

      if (!this.bucket) {
        // Fail loud at boot rather than on the first upload.
        throw new Error('STORAGE_DRIVER=s3 but S3_BUCKET is not set.');
      }

      this.s3 = new S3Client({
        region,
        ...(endpoint ? { endpoint, forcePathStyle: true } : { forcePathStyle }),
        // When keys are omitted the SDK falls back to the default credential
        // chain (IAM role / instance profile), which is preferred in production.
        ...(accessKeyId && secretAccessKey
          ? { credentials: { accessKeyId, secretAccessKey } }
          : {}),
      });
      this.logger.log(
        `Storage driver=s3 bucket=${this.bucket} region=${region}${endpoint ? ` endpoint=${endpoint}` : ''} sse=${this.sse}`,
      );
    }
  }

  async put(buffer: Buffer, originalName: string): Promise<StoredObject> {
    const fileHash = createHash('sha256').update(buffer).digest('hex');
    const storageKey = `${new Date().getFullYear()}/${randomUUID()}-${this.sanitise(originalName)}`;

    if (this.driver === 's3') {
      await this.s3!.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
          Body: buffer,
          ContentLength: buffer.length,
          ServerSideEncryption: this.sse as never,
          // Integrity guard: S3 verifies the body against this hash on write.
          ChecksumSHA256: Buffer.from(fileHash, 'hex').toString('base64'),
        }),
      );
    } else {
      const fullPath = join(this.root, storageKey);
      await fs.mkdir(dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, buffer);
    }
    return { storageKey, fileHash, fileSize: buffer.length };
  }

  async get(storageKey: string): Promise<Buffer> {
    if (this.driver === 's3') {
      const res = await this.s3!.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }),
      );
      if (!res.Body) throw new Error(`S3 object has no body: ${storageKey}`);
      return Buffer.from(await res.Body.transformToByteArray());
    }
    return fs.readFile(join(this.root, storageKey));
  }

  /**
   * Verifies the backend is reachable and the bucket exists. Call from a
   * health check; never blocks request handling.
   */
  async healthCheck(): Promise<boolean> {
    if (this.driver !== 's3') return true;
    try {
      await this.s3!.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch (err) {
      this.logger.error(`S3 health check failed for bucket ${this.bucket}: ${(err as Error).message}`);
      return false;
    }
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
