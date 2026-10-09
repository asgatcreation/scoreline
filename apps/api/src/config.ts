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
