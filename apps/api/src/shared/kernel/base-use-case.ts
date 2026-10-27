import { SystemClock } from './clock';
import type { ClockPort } from './clock';
import { DomainError, InternalError } from './domain-error';
import type { LoggerPort } from './logger.port';
import { Result } from './result';

/**
 * Template-method base class for application use cases.
 *
 * `run` executes three steps: `validate` the input, `execute` the work,
 * and map any thrown error to a `DomainError` so presentation code only
 * ever sees `Result`. Timing and logging go through the injected ports.
 */
export abstract class BaseUseCase<TInput, TOutput> {
  protected constructor(
    protected readonly logger: LoggerPort,
    protected readonly clock: ClockPort = new SystemClock(),
  ) {}

  /**
   * Validate the input before execution. Return a `DomainError` to
   * reject the input without running `execute`, or `null` when valid.
   */
  protected validate(): DomainError | null {
    return null;
  }

  protected abstract execute(input: TInput): Promise<Result<TOutput, DomainError>>;

  /**
   * Map an unexpected thrown value to a `DomainError`. Override to
   * translate infrastructure errors (e.g. Prisma codes) into typed
   * domain errors; the default keeps the cause and returns 500.
   */
  protected mapError(error: unknown): DomainError {
    if (error instanceof DomainError) {
      return error;
    }
    return new InternalError('An unexpected error occurred', { cause: error });
  }

  async run(input: TInput): Promise<Result<TOutput, DomainError>> {
    const useCaseName = this.constructor.name;
    const invalid = this.validate();
    if (invalid !== null) {
      this.logger.warn(`${useCaseName} input validation failed`, {
        useCase: useCaseName,
        code: invalid.code,
      });
      return Result.err<TOutput, DomainError>(invalid);
    }

    const startedAt = this.clock.now().getTime();
    try {
      const result = await this.execute(input);
      result.match({
        ok: () => {
          this.logger.info(`${useCaseName} succeeded`, {
            useCase: useCaseName,
            durationMs: this.clock.now().getTime() - startedAt,
          });
        },
        err: (error) => {
          this.logger.warn(`${useCaseName} failed`, {
            useCase: useCaseName,
            code: error.code,
            durationMs: this.clock.now().getTime() - startedAt,
          });
        },
      });
      return result;
    } catch (error: unknown) {
      const mapped = this.mapError(error);
      this.logger.error(`${useCaseName} threw`, {
        useCase: useCaseName,
        code: mapped.code,
        durationMs: this.clock.now().getTime() - startedAt,
      });
      return Result.err<TOutput, DomainError>(mapped);
    }
  }
}
