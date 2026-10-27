import type { ArgumentsHost } from '@nestjs/common';
import { DomainError } from '../../kernel/domain-error';
import { runWithRequestContext } from '../../application/request-context';
import { DomainErrorFilter } from './domain-error.filter';

class NotFoundError extends DomainError {
  readonly code = 'ORDER_NOT_FOUND';
  readonly httpStatus = 404;

  constructor() {
    super('Order EXP-1042 does not exist');
  }
}

interface RecordedResponse {
  statusCode: number;
  contentType: string;
  body: unknown;
}

function mockHost(exceptionUrl: string): { host: ArgumentsHost; recorded: RecordedResponse } {
  const recorded: RecordedResponse = { statusCode: 0, contentType: '', body: null };
  const response = {
    status: (code: number): unknown => {
      recorded.statusCode = code;
      return response;
    },
    type: (contentType: string): unknown => {
      recorded.contentType = contentType;
      return response;
    },
    json: (body: unknown): unknown => {
      recorded.body = body;
      return response;
    },
  };
  const host = {
    switchToHttp: (): unknown => ({
      getRequest: (): unknown => ({ url: exceptionUrl, method: 'GET' }),
      getResponse: (): unknown => response,
    }),
    switchToRpc: (): unknown => null,
    switchToWs: (): unknown => null,
    getClass: (): unknown => null,
    getHandler: (): unknown => null,
    getArgs: (): unknown[] => [],
    getArgByIndex: (): unknown => null,
    switchToGraphQl: (): unknown => null,
  } as unknown as ArgumentsHost;
  return { host, recorded };
}

describe('DomainErrorFilter', () => {
  it('maps a DomainError to RFC 7807 problem+json', () => {
    const filter = new DomainErrorFilter();
    const { host, recorded } = mockHost('/api/v1/orders/1');

    runWithRequestContext({ correlationId: 'corr-1' }, () => {
      filter.catch(new NotFoundError(), host);
    });

    expect(recorded.statusCode).toBe(404);
    expect(recorded.contentType).toBe('application/problem+json');
    expect(recorded.body).toMatchObject({
      status: 404,
      title: 'Not Found',
      detail: 'Order EXP-1042 does not exist',
      instance: '/api/v1/orders/1',
      code: 'ORDER_NOT_FOUND',
      correlationId: 'corr-1',
    });
    expect(typeof (recorded.body as { type: string }).type).toBe('string');
  });

  it('maps an unknown error to a generic 500 without internals', () => {
    const filter = new DomainErrorFilter();
    const { host, recorded } = mockHost('/health');

    runWithRequestContext({ correlationId: 'corr-2' }, () => {
      filter.catch(new Error('postgres connection string leaked'), host);
    });

    expect(recorded.statusCode).toBe(500);
    expect(recorded.contentType).toBe('application/problem+json');
    expect(recorded.body).toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
      correlationId: 'corr-2',
    });
    expect(JSON.stringify(recorded.body)).not.toContain('postgres');
  });
});
