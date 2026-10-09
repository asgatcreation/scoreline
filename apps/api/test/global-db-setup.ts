import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { directDatabaseUrl } from '../src/database/database-url.js';

/**
 * Database tests run in their own Postgres schema, so they can never touch
 * real data in "public". CI points TEST_DATABASE_URL at a throwaway
 * Postgres; locally the Neon database from apps/api/.env is reused.
 */
export const TEST_SCHEMA = 'scoreline_test';

export default function setup(): void {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.warn('No TEST_DATABASE_URL or DATABASE_URL: database tests will be skipped.');
    return;
  }

  const migrationUrl = new URL(directDatabaseUrl({ DATABASE_URL: url })!);
  migrationUrl.searchParams.set('schema', TEST_SCHEMA);
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DIRECT_DATABASE_URL: migrationUrl.toString() },
  });

  process.env.DATABASE_URL = url;
  process.env.DATABASE_SCHEMA = TEST_SCHEMA;
  process.env.TEST_DB_READY = '1';
}
