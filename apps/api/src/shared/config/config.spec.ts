import { ConfigValidationError, loadAppConfig } from './app-config';

function validSource(): Record<string, string | undefined> {
  return {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:5173',
    API_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/expeditor',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'a'.repeat(32),
    COOKIE_SECRET: 'b'.repeat(32),
  };
}

describe('loadAppConfig', () => {
  it('validates a minimal source and applies defaults', () => {
    const config = loadAppConfig(validSource());
    expect(config.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/expeditor');
    expect(config.REDIS_KEY_PREFIX).toBe('exp:');
    expect(config.CONFIDENCE_THRESHOLD).toBe(0.7);
    expect(config.IDENTIFIER_PROVIDER).toBe('meta');
  });

  it('fails fast with a readable list when variables are missing', () => {
    let caught: unknown;
    try {
      loadAppConfig({});
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
    const message = (caught as ConfigValidationError).message;
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('APP_URL');
    expect(message).toContain('JWT_SECRET');
  });

  it('rejects a non-URL value', () => {
    let caught: unknown;
    try {
      loadAppConfig({ ...validSource(), APP_URL: 'not-a-url' });
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
    expect((caught as ConfigValidationError).message).toContain('APP_URL');
  });

  it('never echoes secret values in the error', () => {
    const secret = `super-secret-value-${'x'.repeat(40)}`;
    let caught: unknown;
    try {
      // JWT_SECRET too short on purpose; DATABASE_URL carries the "secret".
      loadAppConfig({ ...validSource(), JWT_SECRET: 'short', DATABASE_URL: secret });
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
    expect((caught as ConfigValidationError).message).not.toContain(secret);
    expect((caught as ConfigValidationError).message).not.toContain('short');
  });

  it('rejects a short JWT_SECRET', () => {
    expect(() => loadAppConfig({ ...validSource(), JWT_SECRET: 'short' })).toThrow(
      ConfigValidationError,
    );
  });
});
