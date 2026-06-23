import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';
import { CorrelationIdMiddleware } from './observability/correlation-id.middleware';

function mockHost(req: Record<string, unknown>) {
  const json = jest.fn();
  const res = { status: jest.fn().mockReturnValue({ json }), statusCode: 200 };
  return {
    host: { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) },
    res, json,
  };
}

describe('AllExceptionsFilter', () => {
  it('reuses the request correlation id and never leaks 5xx internals', async () => {
    const obs = { operationalFailure: jest.fn().mockResolvedValue(undefined) };
    const filter = new AllExceptionsFilter(obs as never);
    const req = { method: 'POST', url: '/api/awards/x/document', path: '/api/awards/x/document', correlationId: 'corr-123', user: { id: 'u1' } };
    const { host, res, json } = mockHost(req);

    filter.catch(new Error('secret db dsn leaked here'), host as never);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = json.mock.calls[0][0];
    expect(body).toMatchObject({ statusCode: 500, message: 'Internal server error', correlationId: 'corr-123' });
    // No internal detail leaks to the client.
    expect(JSON.stringify(body)).not.toContain('secret db dsn');
    // A 5xx records an operational event tagged by component (awards → pdf).
    expect(obs.operationalFailure).toHaveBeenCalledWith(expect.objectContaining({ component: 'pdf', correlationId: 'corr-123', userId: 'u1' }));
  });

  it('passes through a 4xx client message without an operational event', () => {
    const obs = { operationalFailure: jest.fn() };
    const filter = new AllExceptionsFilter(obs as never);
    const req = { method: 'GET', url: '/api/cases/1', path: '/api/cases/1', correlationId: 'corr-9' };
    const { json } = mockHost(req);

    filter.catch(new BadRequestException('Title is required.'), { switchToHttp: () => ({ getResponse: () => ({ status: () => ({ json }) }), getRequest: () => req }) } as never);

    const body = json.mock.calls[0][0];
    expect(body).toMatchObject({ statusCode: 400, message: 'Title is required.', correlationId: 'corr-9' });
    expect(obs.operationalFailure).not.toHaveBeenCalled();
  });

  it('escalates an unhandled auth 5xx to SEV1', () => {
    const obs = { operationalFailure: jest.fn().mockResolvedValue(undefined) };
    const filter = new AllExceptionsFilter(obs as never);
    const req = { method: 'POST', url: '/api/auth/login', path: '/api/auth/login', correlationId: 'c' };
    const { host } = mockHost(req);
    filter.catch(new HttpException('x', 500), host as never);
    expect(obs.operationalFailure).toHaveBeenCalledWith(expect.objectContaining({ component: 'auth', severity: 'SEV1' }));
  });
});

describe('CorrelationIdMiddleware', () => {
  const mw = new CorrelationIdMiddleware();

  it('reuses a valid inbound correlation id', () => {
    const req = { headers: { 'x-correlation-id': 'trace-abc' } } as never;
    const setHeader = jest.fn();
    const next = jest.fn();
    mw.use(req as never, { setHeader } as never, next);
    expect((req as { correlationId: string }).correlationId).toBe('trace-abc');
    expect(setHeader).toHaveBeenCalledWith('X-Correlation-Id', 'trace-abc');
    expect(next).toHaveBeenCalled();
  });

  it('generates a correlation id when none is supplied', () => {
    const req = { headers: {} } as never;
    const next = jest.fn();
    mw.use(req as never, { setHeader: jest.fn() } as never, next);
    expect((req as { correlationId: string }).correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ignores a malformed inbound id and generates a fresh one', () => {
    const req = { headers: { 'x-correlation-id': 'bad id with spaces & symbols!' } } as never;
    mw.use(req as never, { setHeader: jest.fn() } as never, jest.fn());
    expect((req as { correlationId: string }).correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
