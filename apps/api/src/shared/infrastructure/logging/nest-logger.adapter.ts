import { Injectable, Logger } from '@nestjs/common';
import { getCorrelationId } from '../../application/request-context';
import type { LoggerPort } from '../../kernel/logger.port';

/** NestJS DI token for the `LoggerPort`. */
export const LOGGER_PORT = Symbol('LOGGER_PORT');

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured JSON logger behind the kernel `LoggerPort`, adapted to the
 * NestJS `Logger`. Every line carries the active correlation ID so
 * requests, use cases and event handlers can be traced end to end.
 */
@Injectable()
export class NestLoggerAdapter implements LoggerPort {
  private readonly logger = new Logger('App');

  debug(message: string, meta?: Record<string, unknown>): void {
    this.write('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write('error', message, meta);
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      correlationId: getCorrelationId() ?? 'none',
      ...(meta ?? {}),
    });
    switch (level) {
      case 'debug':
        this.logger.debug(line);
        break;
      case 'info':
        this.logger.log(line);
        break;
      case 'warn':
        this.logger.warn(line);
        break;
      case 'error':
        this.logger.error(line);
        break;
    }
  }
}

export type { LoggerPort };
