import type { PrismaService } from '../src/database/prisma.service.js';
import { TEST_SCHEMA } from './global-db-setup.js';

export const hasTestDb = process.env.TEST_DB_READY === '1';

/** Empties every table in the test schema (and only there). */
export async function resetDb(prisma: PrismaService): Promise<void> {
  if (process.env.DATABASE_SCHEMA !== TEST_SCHEMA) {
    throw new Error(`Refusing to reset: tests must run in schema "${TEST_SCHEMA}"`);
  }
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = ${TEST_SCHEMA} AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${TEST_SCHEMA}"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
}
