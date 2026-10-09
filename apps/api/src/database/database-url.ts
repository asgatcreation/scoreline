/**
 * Neon gives a pooled connection string (host contains "-pooler"). The app
 * uses it as-is; migrations need a direct connection, which is the same host
 * without "-pooler". DIRECT_DATABASE_URL overrides the derived value.
 *
 * A free Neon database sleeps when idle and takes a few seconds to wake, so
 * the migration connection gets a generous connect_timeout. Prisma's
 * migration engine can't do channel_binding=require (Neon adds it), so it is
 * dropped there; the connection is still TLS-encrypted via sslmode.
 */
export function directDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const source = env.DIRECT_DATABASE_URL || env.DATABASE_URL;
  if (!source) return undefined;
  const url = new URL(source);
  if (!env.DIRECT_DATABASE_URL) url.hostname = url.hostname.replace('-pooler.', '.');
  url.searchParams.delete('channel_binding');
  if (!url.searchParams.has('connect_timeout')) url.searchParams.set('connect_timeout', '30');
  return url.toString();
}

/**
 * pg treats sslmode=require as verify-full today and warns that this will
 * change. Ask for verify-full explicitly so behaviour is stable and quiet.
 */
export function normaliseSslMode(connectionString: string): string {
  const url = new URL(connectionString);
  if (url.searchParams.get('sslmode') === 'require') url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}
