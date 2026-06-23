import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';

export type Severity = 'SEV1' | 'SEV2' | 'SEV3';

export interface OperationalFailureInput {
  /** The subsystem: storage | email | video | screening | pdf | deadline | auth | db | api | … */
  component: string;
  detail: string;
  severity?: Severity;
  caseId?: string;
  correlationId?: string;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Records audit-friendly operational events for critical failures. Writes a
 * structured error log AND an append-only audit row (action OPERATIONAL_FAILURE)
 * so a failure affecting cases/notices/documents/hearings/deadlines/awards/access
 * can be detected and investigated. Details are operator-facing only — callers
 * must not pass secrets or confidential case material.
 */
@Injectable()
export class ObservabilityService {
  private readonly logger = new Logger('Operational');

  constructor(private readonly audit: AuditService) {}

  async operationalFailure(input: OperationalFailureInput): Promise<void> {
    const severity = input.severity ?? 'SEV2';
    this.logger.error(JSON.stringify({
      component: input.component, severity, detail: input.detail,
      correlationId: input.correlationId, caseId: input.caseId, ...input.metadata,
    }));
    await this.audit.record({
      userId: input.userId ?? null,
      action: 'OPERATIONAL_FAILURE',
      entityType: input.component,
      caseId: input.caseId,
      metadata: { severity, detail: input.detail, correlationId: input.correlationId, ...input.metadata },
    });
  }
}
