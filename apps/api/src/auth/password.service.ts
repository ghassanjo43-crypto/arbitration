import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';

/**
 * Argon2id password hashing with a server-side pepper. The pepper is mixed in
 * via associated data so a database leak alone is insufficient to verify.
 */
@Injectable()
export class PasswordService {
  private readonly pepper: Buffer;

  constructor(config: ConfigService) {
    this.pepper = Buffer.from(config.get<string>('security.passwordPepper') ?? 'dev-pepper');
  }

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
      secret: this.pepper,
    });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain, { secret: this.pepper });
    } catch {
      return false;
    }
  }
}
