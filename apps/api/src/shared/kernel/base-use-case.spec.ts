import { BaseUseCase } from './base-use-case';
import { FixedClock } from './clock';
import { DomainError, InternalError } from './domain-error';
import type { LoggerPort } from './logger.port';
import { Result } from './result';

class ValidationError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  readonly httpStatus = 400;

  constructor(message = 'invalid input') {
    super(message);
  }
}

class ExecutionError extends DomainError {
  readonly code = 'EXECUTION_FAILED';
  readonly httpStatus = 422;

  constructor(message = 'execution failed') {
    super(message);
  }
}

interface TestInput {
  readonly value: number;
}

class RecordingLogger implements LoggerPort {
  readonly entries: {
    level: string;
    message: string;
    meta: Record<string, unknown> | undefined;
  }[] = [];

  debug(message: string, meta?: Record<string, unknown>): void {
    this.entries.push({ level: 'debug', message, meta });
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.entries.push({ level: 'info', message, meta });
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.entries.push({ level: 'warn', message, meta });
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.entries.push({ level: 'error', message, meta });
  }
}

type Behavior =
  | { readonly kind: 'ok'; readonly value: string }
  | { readonly kind: 'fail'; readonly error: DomainError }
  | { readonly kind: 'throw'; readonly thrown: unknown };

class TestUseCase extends BaseUseCase<TestInput, string> {
  public executions = 0;

  constructor(
    logger: LoggerPort,
    private readonly fixedClock: FixedClock,
    private readonly behavior: Behavior,
  ) {
    super(logger, fixedClock);
  }

  protected override validate(input: TestInput): DomainError | null {
    return input.value >= 0 ? null : new ValidationError('value must be >= 0');
  }

  protected override execute(input: TestInput): Promise<Result<string, DomainError>> {
    this.executions += 1;
    this.fixedClock.advanceBy(125);
    if (this.behavior.kind === 'ok') {
      return Promise.resolve(
        Result.ok<string, DomainError>(`${this.behavior.value}:${String(input.value)}`),
      );
    }
    if (this.behavior.kind === 'fail') {
      return Promise.resolve(Result.err<string, DomainError>(this.behavior.error));
    }
    // The rejection value is intentionally not an Error: at runtime the
    // promise still rejects with the original (possibly non-Error) value,
    // which is exactly the unknown-thrown path under test.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    return Promise.reject(this.behavior.thrown);
  }
}

function setup(behavior: Behavior): {
  useCase: TestUseCase;
  logger: RecordingLogger;
  clock: FixedClock;
} {
  const logger = new RecordingLogger();
  const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
  return { useCase: new TestUseCase(logger, clock, behavior), logger, clock };
}

describe('BaseUseCase', () => {
  it('runs validate, then execute, and returns the success value', async () => {
    const { useCase, logger } = setup({ kind: 'ok', value: 'done' });
    const result = await useCase.run({ value: 3 });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('done:3');
    expect(useCase.executions).toBe(1);
    expect(logger.entries.map((entry) => entry.level)).toEqual(['info']);
  });

  it('rejects invalid input without running execute', async () => {
    const { useCase, logger } = setup({ kind: 'ok', value: 'done' });
    const result = await useCase.run({ value: -1 });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ValidationError);
    expect(useCase.executions).toBe(0);
    expect(logger.entries.map((entry) => entry.level)).toEqual(['warn']);
  });

  it('passes execution failures through and logs a warning', async () => {
    const error = new ExecutionError();
    const { useCase, logger } = setup({ kind: 'fail', error });
    const result = await useCase.run({ value: 1 });

    expect(result.unwrapErr()).toBe(error);
    expect(logger.entries.map((entry) => entry.level)).toEqual(['warn']);
    expect(logger.entries[0]?.meta?.['code']).toBe('EXECUTION_FAILED');
  });

  it('maps a thrown DomainError as-is', async () => {
    const error = new ExecutionError('thrown');
    const { useCase, logger } = setup({ kind: 'throw', thrown: error });
    const result = await useCase.run({ value: 1 });

    expect(result.unwrapErr()).toBe(error);
    expect(logger.entries.map((entry) => entry.level)).toEqual(['error']);
  });

  it('maps a thrown unknown value to InternalError without leaking it', async () => {
    const { useCase } = setup({ kind: 'throw', thrown: 'db exploded' });
    const result = await useCase.run({ value: 1 });

    expect(result.isErr()).toBe(true);
    const mapped = result.unwrapErr();
    expect(mapped).toBeInstanceOf(InternalError);
    expect(mapped.httpStatus).toBe(500);
    expect(mapped.message).not.toContain('db exploded');
  });

  it('reports duration measured with the injected clock', async () => {
    const { useCase, logger } = setup({ kind: 'ok', value: 'timed' });
    await useCase.run({ value: 1 });

    // execute() advances the fixed clock by 125 ms, so the success log
    // must carry exactly that duration.
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]?.meta?.['durationMs']).toBe(125);
    expect(useCase.executions).toBe(1);
  });
});
