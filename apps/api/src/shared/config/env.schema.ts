import { z } from 'zod';

/**
 * Validation for every variable in `.env.example` (spec §21), plus
 * `REDIS_KEY_PREFIX` (all Redis keys this app writes start with it;
 * the local Redis is shared with other projects).
 *
 * Secrets are never echoed: failure messages name the variable only.
 */

const nodeEnvSchema = z.enum(['development', 'test', 'production']);

const urlSchema = (label: string): z.ZodString =>
  z
    .string()
    .min(1, `${label} must not be empty`)
    .refine((value) => value.includes('://'), {
      message: `${label} must be a URL`,
    });

const postgresSchema = z
  .string()
  .min(1, 'DATABASE_URL must not be empty')
  .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
    message: 'DATABASE_URL must be a postgresql:// connection string',
  });

const redisSchema = z
  .string()
  .min(1, 'REDIS_URL must not be empty')
  .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
    message: 'REDIS_URL must be a redis:// connection string',
  });

const durationSchema = z
  .string()
  .min(1, 'duration must not be empty')
  .regex(/^\d+[smhd]$/, 'duration must look like 15m, 7d, 30s or 12h');

export const envSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  APP_URL: urlSchema('APP_URL'),
  API_URL: urlSchema('API_URL'),
  DATABASE_URL: postgresSchema,
  DATABASE_URL_TEST: z.string().optional(),
  REDIS_URL: redisSchema,
  REDIS_KEY_PREFIX: z.string().min(1).default('exp:'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: durationSchema.default('15m'),
  REFRESH_TTL_MANAGER: durationSchema.default('7d'),
  REFRESH_TTL_STATION: durationSchema.default('30d'),
  RESET_TOKEN_TTL: durationSchema.default('30m'),

  META_API_BASE_URL: urlSchema('META_API_BASE_URL').default('https://api.meta.ai/v1'),
  META_API_KEY: z.string().optional(),
  MUSE_SPARK_MODEL: z.string().min(1).default('muse-spark-1.3'),
  SAM_MODEL: z.string().min(1).default('sam-3.1'),
  STT_MODEL: z.string().min(1).default('muse-voice-transcribe-1.0'),
  BASETEN_BASE_URL: z.string().optional(),
  BASETEN_API_KEY: z.string().optional(),
  BASETEN_MODEL: z.string().min(1).default('meta-models/muse-spark-open-1026'),
  IDENTIFIER_PROVIDER: z.enum(['meta', 'baseten']).default('meta'),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_MODEL_ID: z.string().optional(),
  ELEVENLABS_VOICE_ID_ES: z.string().optional(),
  ELEVENLABS_VOICE_ID_EN: z.string().optional(),
  PROVIDER_CACHE: z.enum(['on', 'off']).default('on'),
  CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  BLOCKED_ALERT_MINUTES: z.coerce.number().int().positive().default(15),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  // Never `z.coerce.boolean()`: `Boolean('false')` is `true`, so the shipped
  // `SMTP_SECURE=false` would silently enable TLS.
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().min(1).default('AIA Expeditor <no-reply@example.com>'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().min(1).default('./storage'),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  SEED_RESTAURANT_NAME: z.string().min(1).default('Demo Catering Kitchen'),
  SEED_TIME_ZONE: z.string().min(1).default('America/New_York'),
  SEED_ADMIN_EMAIL: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  SEED_STATION_EMAIL: z.string().optional(),
  SEED_STATION_PASSWORD: z.string().optional(),
});

export type RawEnv = z.input<typeof envSchema>;
export type ValidatedEnv = z.output<typeof envSchema>;

/** Keys whose values must never appear in logs or error messages. */
export const SECRET_KEYS: readonly string[] = [
  'DATABASE_URL',
  'DATABASE_URL_TEST',
  'REDIS_URL',
  'JWT_SECRET',
  'COOKIE_SECRET',
  'META_API_KEY',
  'BASETEN_API_KEY',
  'ELEVENLABS_API_KEY',
  'SMTP_PASS',
  'SMTP_USER',
  'S3_SECRET_ACCESS_KEY',
  'S3_ACCESS_KEY_ID',
  'SEED_ADMIN_PASSWORD',
  'SEED_STATION_PASSWORD',
];

/**
 * Format a Zod failure as a readable list of `VARIABLE: reason` lines.
 * Only variable names and generic reasons are included — never values,
 * so secrets cannot leak even if Zod attaches a `received` payload.
 */
export function formatEnvIssues(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const key = issue.path.length > 0 ? String(issue.path[0]) : '(root)';
    return `  - ${key}: ${issue.message}`;
  });
  return `Invalid environment configuration:\n${lines.join('\n')}`;
}
