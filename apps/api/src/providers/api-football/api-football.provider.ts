import { ProviderHttp, type UsageStore } from '../provider-http.js';
import { QuotaTracker } from '../quota.js';
import type { LiveSource, ProviderMatch, ProviderMatchDetails } from '../types.js';
import { TRACKED_COMPETITIONS, trackedByApiFootballId } from '../../football/competitions.js';
import { type AfFixture, mapDetails, mapFixture } from './api-football.mappers.js';

interface AfResponse<T> {
  errors: unknown[] | Record<string, string>;
  results: number;
  response: T[];
}

/**
 * API-Football v3. On the free plan it serves live matches and the three
 * days around today (with full events, line-ups and stats), which is
 * exactly the "fast feed" role.
 */
export class ApiFootballProvider implements LiveSource {
  readonly name = 'API_FOOTBALL' as const;
  readonly http: ProviderHttp;
  private readonly trackedIds = TRACKED_COMPETITIONS.flatMap((c) => (c.afId ? [c.afId] : []));

  constructor(apiKey: string, dailyLimit: number, usage?: UsageStore, fetchImpl?: typeof fetch) {
    this.http = new ProviderHttp({
      provider: this.name,
      baseUrl: 'https://v3.football.api-sports.io',
      headers: { 'x-apisports-key': apiKey },
      // The free plan also caps at 10 requests/minute.
      quota: new QuotaTracker(this.name, { perDay: dailyLimit, perMinute: 10 }),
      usage,
      fetchImpl,
      maxWaitMs: 10_000,
      inspect: (res, body) => {
        const remaining = Number(res.headers.get('x-ratelimit-requests-remaining'));
        const errors = (body as AfResponse<unknown>).errors;
        const first = Array.isArray(errors) ? errors[0] : Object.values(errors ?? {})[0];
        return {
          remaining:
            Number.isFinite(remaining) && res.headers.has('x-ratelimit-requests-remaining')
              ? remaining
              : undefined,
          error: first ? String(first) : undefined,
        };
      },
    });
  }

  async getLive(): Promise<ProviderMatch[]> {
    // One call returns every live match in our competitions, with events.
    const body = await this.http.get<AfResponse<AfFixture>>(
      `/fixtures?live=${this.trackedIds.join('-')}`,
    );
    return this.mapTracked(body.response);
  }

  async getByDate(date: string): Promise<ProviderMatch[]> {
    const body = await this.http.get<AfResponse<AfFixture>>(`/fixtures?date=${date}&timezone=UTC`);
    return this.mapTracked(body.response);
  }

  async getDetails(externalId: string): Promise<ProviderMatchDetails | null> {
    const body = await this.http.get<AfResponse<AfFixture>>(
      `/fixtures?id=${encodeURIComponent(externalId)}`,
    );
    const raw = body.response[0];
    const competition = raw && trackedByApiFootballId(raw.league.id);
    return raw && competition ? mapDetails(raw, competition) : null;
  }

  private mapTracked(fixtures: AfFixture[]): ProviderMatch[] {
    return fixtures.flatMap((f) => {
      const competition = trackedByApiFootballId(f.league.id);
      return competition ? [mapFixture(f, competition)] : [];
    });
  }
}
