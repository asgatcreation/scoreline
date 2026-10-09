import { ProviderError, ProviderHttp, type UsageStore } from './provider-http.js';
import { QuotaTracker } from './quota.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function memoryUsage(start = 0): UsageStore & { calls: number; errors: string[] } {
  const store = {
    calls: start,
    errors: [] as string[],
    load: async () => start,
    increment: async (_p: string, _d: string, error?: string) => {
      store.calls += 1;
      if (error) store.errors.push(error);
    },
  };
  return store;
}

describe('ProviderHttp', () => {
  it('sends headers, counts the request and saves usage', async () => {
    const usage = memoryUsage();
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const http = new ProviderHttp({
      provider: 'API_FOOTBALL',
      baseUrl: 'https://example.test',
      headers: { 'x-key': 'secret' },
      quota: new QuotaTracker('API_FOOTBALL', { perDay: 100 }),
      usage,
      fetchImpl,
    });

    await expect(http.get('/fixtures?live=all')).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.test/fixtures?live=all',
      expect.objectContaining({ headers: { 'x-key': 'secret' } }),
    );
    expect(http.quota.remainingToday()).toBe(99);
    expect(usage.calls).toBe(1);
  });

  it('restores today’s saved count before the first request', async () => {
    const http = new ProviderHttp({
      provider: 'API_FOOTBALL',
      baseUrl: 'https://example.test',
      headers: {},
      quota: new QuotaTracker('API_FOOTBALL', { perDay: 100 }),
      usage: memoryUsage(95),
      fetchImpl: async () => jsonResponse({}),
    });
    await http.get('/status');
    expect(http.quota.remainingToday()).toBe(4);
  });

  it('refuses to spend when the daily budget is gone', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const http = new ProviderHttp({
      provider: 'API_FOOTBALL',
      baseUrl: 'https://example.test',
      headers: {},
      quota: new QuotaTracker('API_FOOTBALL', { perDay: 1 }),
      usage: memoryUsage(1),
      fetchImpl,
    });
    await expect(http.get('/x')).rejects.toMatchObject({ kind: 'quota' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('backs off after a 429 and uses Retry-After', async () => {
    const http = new ProviderHttp({
      provider: 'FOOTBALL_DATA',
      baseUrl: 'https://example.test',
      headers: {},
      quota: new QuotaTracker('FOOTBALL_DATA', { perMinute: 10 }),
      fetchImpl: async () =>
        new Response('slow down', { status: 429, headers: { 'retry-after': '42' } }),
    });
    const err = await http.get('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: 'rate-limit', retryAfterMs: 42_000 });
    expect(http.quota.waitMs()).toBeGreaterThan(41_000);
  });

  it('turns provider error bodies into errors and syncs remaining quota', async () => {
    const http = new ProviderHttp({
      provider: 'API_FOOTBALL',
      baseUrl: 'https://example.test',
      headers: {},
      quota: new QuotaTracker('API_FOOTBALL', { perDay: 100 }),
      fetchImpl: async () => jsonResponse({ errors: { plan: 'Free plans do not have access' } }),
      inspect: (_res, body) => ({
        remaining: 70,
        error: Object.values((body as { errors: Record<string, string> }).errors)[0],
      }),
    });
    await expect(http.get('/x')).rejects.toMatchObject({ kind: 'plan' });
    expect(http.quota.remainingToday()).toBe(70);
  });

  it('reports network failures without leaking query strings', async () => {
    const http = new ProviderHttp({
      provider: 'API_FOOTBALL',
      baseUrl: 'https://example.test',
      headers: {},
      quota: new QuotaTracker('API_FOOTBALL', {}),
      fetchImpl: async () => new Response('nope', { status: 500 }),
    });
    const err = (await http.get('/fixtures?id=1').catch((e: unknown) => e)) as Error;
    expect(err.message).toContain('/fixtures');
    expect(err.message).not.toContain('id=1');
  });
});
