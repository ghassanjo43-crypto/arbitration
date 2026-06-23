import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { ObservabilityService, Severity } from './observability/observability.service';
import { AuthUser } from '../auth/types';

/**
 * Map a request path to the affected subsystem for operational events. Specific
 * resources are matched before the generic documents/storage path so e.g.
 * `/awards/:id/document` (PDF generation) is classified as `pdf`, not `storage`.
 */
function componentForPath(path: string): string {
  if (/\/awards?\b/.test(path)) return 'pdf';
  if (/\/hearings?\b/.test(path)) return 'video';
  if (/\/(notices|webhooks\/email)\b/.test(path)) return 'email';
  if (/\/(compliance|screenings)\b/.test(path)) return 'screening';
  if (/\/(deadlines|procedural-events)\b/.test(path)) return 'deadline';
  if (/\/auth\b/.test(path)) return 'auth';
  if (/\/documents?\b/.test(path)) return 'storage';
  return 'api';
}

/**
 * Global error envelope. Reuses the request correlation id, logs server-side
 * detail, never leaks stack traces or internal messages to the client for 5xx,
 * and records an audit-friendly OPERATIONAL_FAILURE event for 5xx so critical
 * failures are detectable and investigable.
 */
@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  // Optional so the filter still works if constructed without DI (e.g. tests).
  constructor(private readonly observability?: ObservabilityService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { correlationId?: string; user?: AuthUser }>();
    const correlationId = req.correlationId ?? randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'InternalServerError';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as { message?: string | string[]; error?: string };
        message = b.message ?? exception.message;
        error = b.error ?? exception.name;
      }
    }

    if (status >= 500) {
      // Log full detail server-side only; respond generically.
      this.logger.error(`[${correlationId}] ${req.method} ${req.url}`, exception as Error);
      const component = componentForPath(req.path ?? req.url ?? '');
      // Treat an unexpected auth failure as higher severity (access integrity).
      const severity: Severity = component === 'auth' ? 'SEV1' : 'SEV2';
      void this.observability?.operationalFailure({
        component, severity,
        detail: `${req.method} ${req.path}: ${(exception as Error)?.message ?? 'unhandled error'}`.slice(0, 500),
        correlationId, userId: req.user?.id ?? null,
        metadata: { status },
      }).catch(() => undefined);
      message = 'Internal server error';
      error = 'InternalServerError';
    }

    res.status(status).json({ statusCode: status, error, message, correlationId });
  }
}
