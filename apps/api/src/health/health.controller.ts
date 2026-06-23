import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../providers/storage/storage.service';
import { VideoService } from '../providers/video/video.service';
import { ScreeningService } from '../providers/screening/screening.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly video: VideoService,
    private readonly screening: ScreeningService,
  ) {}

  @Get()
  async check() {
    let db = 'unknown';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }
    // Reachability of external providers (local/placeholder/mock are always "up").
    const [storage, video, screening] = await Promise.all([
      this.storage.healthCheck().then((ok) => (ok ? 'up' : 'down')),
      this.video.healthCheck().then((ok) => (ok ? 'up' : 'down')),
      this.screening.healthCheck().then((ok) => (ok ? 'up' : 'down')),
    ]);
    const status = db === 'up' && storage === 'up' && video === 'up' && screening === 'up' ? 'ok' : 'degraded';
    return { status, db, storage, video, screening, time: new Date().toISOString() };
  }
}
