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
