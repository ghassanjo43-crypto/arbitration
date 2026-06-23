import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

/**
 * Assigns a correlation id to every request. Reuses an inbound
 * `X-Correlation-Id` / `X-Request-Id` (so a trace can span the proxy + app),
 * otherwise generates one. The id is echoed on the response header and used by
 * the request logger and the exception filter so a client error and the
 * server-side log/diagnostics share the same id.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request & { correlationId?: string }, res: Response, next: NextFunction): void {
    const inbound = (req.headers['x-correlation-id'] || req.headers['x-request-id']) as string | undefined;
    const correlationId = (inbound && /^[\w-]{1,128}$/.test(inbound)) ? inbound : randomUUID();
    req.correlationId = correlationId;
    res.setHeader('X-Correlation-Id', correlationId);
    next();
  }
}
