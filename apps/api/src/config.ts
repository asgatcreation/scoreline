import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v === 'true' || v === '1'));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: optionalString,
  /** Postgres schema; only tests change it (to keep test data apart). */
  DATABASE_SCHEMA: optionalString,
  API_FOOTBALL_KEY: optionalString,
  FOOTBALL_DATA_TOKEN: optionalString,
  /** Requests per day on the API-Football plan (free = 100). */
  API_FOOTBALL_DAILY_LIMIT: z.coerce.number().int().positive().default(100),
  /** Requests per minute on the football-data.org plan (free = 10). */
  FOOTBALL_DATA_MINUTE_LIMIT: z.coerce.number().int().positive().default(10),
  /** Turn the background ingest worker off (tests, one-off scripts). */
  INGEST_ENABLED: bool,
  /** Demo matches that always play live, clearly labelled "Demo". */
  DEMO_ENABLED: bool,
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string | undefined;
  databaseSchema: string | undefined;
  apiFootballKey: string | undefined;
  footballDataToken: string | undefined;
  apiFootballDailyLimit: number;
  footballDataMinuteLimit: number;
  ingestEnabled: boolean;
  demoEnabled: boolean;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n  ${problems.join('\n  ')}`);
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    databaseSchema: e.DATABASE_SCHEMA,
    apiFootballKey: e.API_FOOTBALL_KEY,
    footballDataToken: e.FOOTBALL_DATA_TOKEN,
    apiFootballDailyLimit: e.API_FOOTBALL_DAILY_LIMIT,
    footballDataMinuteLimit: e.FOOTBALL_DATA_MINUTE_LIMIT,
    ingestEnabled: e.INGEST_ENABLED ?? e.NODE_ENV !== 'test',
    demoEnabled: e.DEMO_ENABLED ?? true,
  };
}

/**
 * Origins allowed to call the API from a browser. Comma-separated in
 * WEB_ORIGIN, e.g. "https://scoreline.vercel.app,http://localhost:3001".
 */
export function corsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.WEB_ORIGIN ?? 'http://localhost:3001';
  return raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

/**
 * Port the API listens on. API_PORT wins so a stray PORT meant for another
 * process (the web dev server, an IDE preview) can't make the API collide
 * with it; hosts like Render only set PORT, which is used next.
 */
export function apiPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.API_PORT || env.PORT;
  const port = Number(raw);
  return raw && Number.isInteger(port) && port > 0 ? port : 4000;
}
