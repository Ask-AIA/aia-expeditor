import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { runWithRequestContext } from '../../application/request-context';
import { isUuid } from '../../kernel/brand';
import { UuidGenerator } from '../../kernel/id-generator';

const HEADER = 'X-Correlation-Id';
const generator = new UuidGenerator();

/**
 * Accepts `X-Correlation-Id` when it is a valid UUID, otherwise
 * generates one. The ID is echoed in the response header and propagated
 * through `AsyncLocalStorage` to the logger and event handlers.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const received = request.headers[HEADER.toLowerCase()];
    const correlationId =
      typeof received === 'string' && isUuid(received) ? received : generator.generate();
    response.setHeader(HEADER, correlationId);
    runWithRequestContext({ correlationId }, () => {
      next();
    });
  }
}
