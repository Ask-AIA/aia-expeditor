import type { Request, Response } from 'express';
import { getCorrelationId } from '../../application/request-context';
import { isUuid } from '../../kernel/brand';
import { CorrelationMiddleware } from './correlation.middleware';

const VALID_UUID = '0193e5e0-7a2b-7c1d-9e2f-3a4b5c6d7e8f';

function run(incoming: unknown): { echoed: string | null; seen: (string | undefined)[] } {
  const middleware = new CorrelationMiddleware();
  const echoed: { value: string | null } = { value: null };
  const seen: (string | undefined)[] = [];
  const request = {
    headers: incoming === undefined ? {} : { 'x-correlation-id': incoming },
  } as unknown as Request;
  const response = {
    setHeader: (_name: string, value: string): void => {
      echoed.value = value;
    },
  } as unknown as Response;
  middleware.use(request, response, () => {
    seen.push(getCorrelationId());
  });
  return { echoed: echoed.value, seen };
}

describe('CorrelationMiddleware', () => {
  it('accepts a valid incoming UUID, echoes it, and propagates it', () => {
    const { echoed, seen } = run(VALID_UUID);
    expect(echoed).toBe(VALID_UUID);
    expect(seen).toEqual([VALID_UUID]);
  });

  it('generates a UUID when the header is missing or invalid', () => {
    for (const incoming of [undefined, 'not-a-uuid', 42]) {
      const { echoed, seen } = run(incoming);
      expect(echoed).not.toBeNull();
      expect(isUuid(echoed)).toBe(true);
      expect(seen).toEqual([echoed]);
    }
  });
});
