import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthzModule } from './authz/authz.module';
import { ProvidersModule } from './providers/providers.module';
import { AuthModule } from './auth/auth.module';
import { ArbitratorsModule } from './arbitrators/arbitrators.module';
import { ContentModule } from './content/content.module';
import { CasesModule } from './cases/cases.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { RegistryModule } from './registry/registry.module';
import { PartiesModule } from './parties/parties.module';
import { LawyersModule } from './lawyers/lawyers.module';
import { DocumentsModule } from './documents/documents.module';
import { MessagesModule } from './messages/messages.module';
import { DeadlinesModule } from './deadlines/deadlines.module';
import { HearingsModule } from './hearings/hearings.module';
import { PaymentsModule } from './payments/payments.module';
import { AwardsModule } from './awards/awards.module';
import { UsersModule } from './users/users.module';
import { FeesModule } from './fees/fees.module';
import { RulesModule } from './rules/rules.module';
import { ServiceModule } from './service/service.module';
import { FilingsModule } from './filings/filings.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      // Root .env (monorepo) first, then a local apps/api/.env override if present.
      envFilePath: ['../../.env', '.env'],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: (parseInt(process.env.RATE_LIMIT_TTL ?? '60', 10)) * 1000,
        limit: parseInt(process.env.RATE_LIMIT_MAX ?? '120', 10),
      },
    ]),
    // Cross-cutting / global
    PrismaModule,
    AuditModule,
    AuthzModule,
    ProvidersModule,
    // Feature modules
    AuthModule,
    ArbitratorsModule,
    ContentModule,
    CasesModule,
    AppointmentsModule,
    RegistryModule,
    PartiesModule,
    LawyersModule,
    DocumentsModule,
    MessagesModule,
    DeadlinesModule,
    HearingsModule,
    PaymentsModule,
    AwardsModule,
    UsersModule,
    FeesModule,
    RulesModule,
    ServiceModule,
    FilingsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Apply the default rate limit to every route (auth routes add stricter @Throttle).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
