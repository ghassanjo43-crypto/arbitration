import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../providers/storage/storage.service';
import { VideoService } from '../providers/video/video.service';
import { ScreeningService } from '../providers/screening/screening.service';
import { EmailService } from '../providers/email/email.service';

export type CheckState = 'up' | 'down';

export interface ReadinessResult {
  status: 'ready' | 'not_ready';
  checks: {
    db: CheckState;
    migrations: CheckState;
    storage: CheckState;
    video: CheckState;
    email: CheckState;
    screening: CheckState;
  };
  time: string;
}

/**
 * Deep readiness: is the service actually usable? Checks the database, that
 * migrations are in a healthy applied state, and that the critical providers
 * (storage, video, email config, screening) are reachable/configured. Used by
 * the /readiness probe and uptime monitoring; returns 503 when not ready.
 */
@Injectable()
export class ReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly video: VideoService,
    private readonly screening: ScreeningService,
    private readonly email: EmailService,
  ) {}

  async check(): Promise<ReadinessResult> {
    const [db, migrations, storage, video, screening] = await Promise.all([
      this.dbUp(),
      this.migrationsHealthy(),
      this.storage.healthCheck().then(toState).catch(() => 'down' as CheckState),
      this.video.healthCheck().then(toState).catch(() => 'down' as CheckState),
      this.screening.healthCheck().then(toState).catch(() => 'down' as CheckState),
    ]);
    const email: CheckState = this.email.healthCheck() ? 'up' : 'down';
    const checks = { db, migrations, storage, video, email, screening };
    const status = Object.values(checks).every((s) => s === 'up') ? 'ready' : 'not_ready';
    return { status, checks, time: new Date().toISOString() };
  }

  private async dbUp(): Promise<CheckState> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }

  /**
   * Migrations are "up" when the _prisma_migrations table exists, has applied
   * rows, and none are unfinished (a partially-applied/failed migration is a
   * readiness failure that a deploy must resolve).
   */
  private async migrationsHealthy(): Promise<CheckState> {
    try {
      const rows = await this.prisma.$queryRaw<{ applied: bigint; unfinished: bigint }[]>`
        SELECT
          COUNT(*) FILTER (WHERE finished_at IS NOT NULL) AS applied,
          COUNT(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS unfinished
        FROM "_prisma_migrations"`;
      const r = rows?.[0];
      if (!r) return 'down';
      return Number(r.applied) > 0 && Number(r.unfinished) === 0 ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}

function toState(ok: boolean): CheckState {
  return ok ? 'up' : 'down';
}
