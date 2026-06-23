import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { AuthUser } from '../../auth/types';

/**
 * Structured per-request access log: method, path, status, duration, the
 * correlation id, and — where available — the authenticated user id, roles, and
 * the case id from the route. It deliberately logs only metadata, never request
 * bodies or query values, so no secrets or confidential case material leak.
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Request');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { correlationId?: string; user?: AuthUser; params?: Record<string, string> }>();
    const res = http.getResponse<Response>();
    const start = Date.now();

    const finish = (errorStatus?: number) => {
      const status = errorStatus ?? res.statusCode;
      const meta = {
        method: req.method,
        path: this.safePath(req),
        status,
        durationMs: Date.now() - start,
        correlationId: req.correlationId,
        userId: req.user?.id,
        roles: req.user?.roles,
        caseId: this.caseId(req),
      };
      const line = JSON.stringify(meta);
      if (status >= 500) this.logger.error(line);
      else if (status >= 400) this.logger.warn(line);
      else this.logger.log(line);
    };

    return next.handle().pipe(
      tap({
        next: () => finish(),
        // The exception filter sets the real status; log with its mapped status.
        error: (err: { status?: number }) => finish(err?.status ?? 500),
      }),
    );
  }

  /** The route path with param placeholders, not the raw URL (no query/ids leak). */
  private safePath(req: Request & { route?: { path?: string } }): string {
    return req.route?.path ?? req.path ?? req.url.split('?')[0];
  }

  /** Best-effort case id from common route params (audit-friendly, not sensitive). */
  private caseId(req: { params?: Record<string, string> }): string | undefined {
    return req.params?.caseId;
  }
}
