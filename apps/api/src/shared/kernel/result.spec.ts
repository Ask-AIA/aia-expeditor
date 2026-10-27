import { DomainError } from './domain-error';
import { Result } from './result';

class TestError extends DomainError {
  readonly code = 'TEST_ERROR';
  readonly httpStatus = 400;

  constructor(message = 'test error') {
    super(message);
  }
}

describe('Result', () => {
  it('ok() reports success and unwraps the value', () => {
    const result = Result.ok<number, TestError>(7);
    expect(result.isOk()).toBe(true);
    expect(result.isErr()).toBe(false);
    expect(result.unwrap()).toBe(7);
  });

  it('err() reports failure and unwraps the error', () => {
    const error = new TestError();
    const result = Result.err<number, TestError>(error);
    expect(result.isOk()).toBe(false);
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBe(error);
  });

  it('unwrap() on an error throws the error itself', () => {
    const error = new TestError('boom');
    expect(() => Result.err<number, TestError>(error).unwrap()).toThrow(error);
  });

  it('unwrapErr() on a success throws', () => {
    expect(() => Result.ok<number, TestError>(1).unwrapErr()).toThrow();
  });

  it('map() transforms the value and passes errors through', () => {
    const mapped = Result.ok<number, TestError>(3).map((n) => n * 2);
    expect(mapped.unwrap()).toBe(6);

    const error = new TestError();
    const mappedErr = Result.err<number, TestError>(error).map((n) => n * 2);
    expect(mappedErr.isErr()).toBe(true);
    expect(mappedErr.unwrapErr()).toBe(error);
  });

  it('flatMap() chains results and short-circuits on error', () => {
    const chained = Result.ok<number, TestError>(3).flatMap((n) =>
      Result.ok<string, TestError>(`n=${String(n)}`),
    );
    expect(chained.unwrap()).toBe('n=3');

    const error = new TestError();
    const shortCircuited = Result.err<number, TestError>(error).flatMap((n) =>
      Result.ok<string, TestError>(`n=${String(n)}`),
    );
    expect(shortCircuited.unwrapErr()).toBe(error);

    const innerError = new TestError('inner');
    const innerFails = Result.ok<number, TestError>(3).flatMap(() =>
      Result.err<string, TestError>(innerError),
    );
    expect(innerFails.isErr()).toBe(true);
    expect(innerFails.unwrapErr()).toBe(innerError);
  });

  it('match() dispatches to the right branch', () => {
    const okLabel = Result.ok<number, TestError>(5).match({
      ok: (value) => `ok:${String(value)}`,
      err: () => 'err',
    });
    const errLabel = Result.err<number, TestError>(new TestError()).match({
      ok: () => 'ok',
      err: (error) => `err:${error.code}`,
    });
    expect(okLabel).toBe('ok:5');
    expect(errLabel).toBe('err:TEST_ERROR');
  });

  it('combine() collects values and returns the first error', () => {
    const combined = Result.combine([
      Result.ok<number, TestError>(1),
      Result.ok<number, TestError>(2),
    ]);
    expect(combined.unwrap()).toEqual([1, 2]);
    expect(Result.combine([]).unwrap()).toEqual([]);

    const first = new TestError('first');
    const second = new TestError('second');
    const failed = Result.combine([
      Result.ok<number, TestError>(1),
      Result.err<number, TestError>(first),
      Result.err<number, TestError>(second),
    ]);
    expect(failed.isErr()).toBe(true);
    expect(failed.unwrapErr()).toBe(first);
  });
});
