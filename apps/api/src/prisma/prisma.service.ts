import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] });
  }

  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    // Don't crash the whole API if the database is not yet reachable — this lets
    // the public site and compute-only endpoints serve while the DB is configured.
    try {
      await this.$connect();
      this.logger.log('Database connected.');
    } catch (err) {
      this.logger.error('Database connection failed at startup; continuing. DB endpoints will error until configured.', err as Error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
