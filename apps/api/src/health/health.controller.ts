import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../providers/storage/storage.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
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
    // Verifies the object store is reachable (S3 bucket exists / local is always ok).
    const storage = (await this.storage.healthCheck()) ? 'up' : 'down';
    const status = db === 'up' && storage === 'up' ? 'ok' : 'degraded';
    return { status, db, storage, time: new Date().toISOString() };
  }
}
