import { loadAppConfig } from './app-config';

function sourceWith(overrides: Record<string, string>): Record<string, string | undefined> {
  return {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:5173',
    API_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/expeditor',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'a'.repeat(32),
    COOKIE_SECRET: 'b'.repeat(32),
    ...overrides,
  };
}

describe('SMTP_SECURE parsing', () => {
  it('parses the string "false" as boolean false', () => {
    expect(loadAppConfig(sourceWith({ SMTP_SECURE: 'false' })).SMTP_SECURE).toBe(false);
  });

  it('parses the string "true" as boolean true', () => {
    expect(loadAppConfig(sourceWith({ SMTP_SECURE: 'true' })).SMTP_SECURE).toBe(true);
  });

  it('defaults to false when unset', () => {
    expect(loadAppConfig(sourceWith({})).SMTP_SECURE).toBe(false);
  });
});
