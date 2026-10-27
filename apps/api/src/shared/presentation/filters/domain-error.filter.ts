import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { getCorrelationId } from '../../application/request-context';
import { DomainError } from '../../kernel/domain-error';

const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

interface ProblemDocument {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  correlationId: string;
}

function problemType(code: string): string {
  return `https://aia-expeditor.local/problems/${code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

/**
 * Maps `DomainError` to RFC 7807 `application/problem+json` and hides
 * unexpected failures behind a generic 500 (logged with the stack and
 * the correlation ID).
 */
@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const correlationId = getCorrelationId() ?? 'none';
    const instance = request.url;

    if (exception instanceof DomainError) {
      const status = exception.httpStatus;
      const body: ProblemDocument = {
        type: problemType(exception.code),
        title: STATUS_TITLES[status] ?? 'Error',
        status,
        detail: exception.message,
        instance,
        code: exception.code,
        correlationId,
      };
      response.status(status).type('application/problem+json').json(body);
      return;
    }

    this.logger.error(`Unhandled error on ${request.method} ${instance}`, {
      correlationId,
      error:
        exception instanceof Error ? (exception.stack ?? exception.message) : String(exception),
    });
    const body: ProblemDocument = {
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred',
      instance,
      code: 'INTERNAL_ERROR',
      correlationId,
    };
    response.status(500).type('application/problem+json').json(body);
  }
}
