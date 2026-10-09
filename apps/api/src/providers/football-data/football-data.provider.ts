import { addDays } from '@scoreline/shared';
import { TRACKED_COMPETITIONS, trackedByFootballDataCode } from '../../football/competitions.js';
import { ProviderHttp, type UsageStore } from '../provider-http.js';
import { QuotaTracker } from '../quota.js';
import type {
  LiveSource,
  ProviderMatch,
  ProviderMatchDetails,
  ProviderScorer,
  ProviderSeason,
  ProviderStandings,
  SeasonSource,
} from '../types.js';
import {
  type FdMatch,
  type FdScorersResponse,
  type FdStandingsResponse,
  mapMatch,
  mapScorers,
  mapStandings,
} from './football-data.mappers.js';

/**
 * football-data.org v4. The free plan gives whole seasons of fixtures,
 * results, tables and top scorers for 12 competitions at 10 requests a
 * minute. Scores are delayed, so it is the "season feed"; it can also act
 * as a slower live feed when no API-Football key is configured.
 */
export class FootballDataProvider implements SeasonSource, LiveSource {
  readonly name = 'FOOTBALL_DATA' as const;
  readonly http: ProviderHttp;

  constructor(token: string, perMinute: number, usage?: UsageStore, fetchImpl?: typeof fetch) {
    this.http = new ProviderHttp({
      provider: this.name,
      baseUrl: 'https://api.football-data.org/v4',
      headers: { 'X-Auth-Token': token },
      quota: new QuotaTracker(this.name, { perMinute }),
      usage,
      fetchImpl,
      // Waiting a few seconds for the next per-minute slot is fine.
      maxWaitMs: 65_000,
    });
  }

  competitions(): string[] {
    return TRACKED_COMPETITIONS.filter((c) => c.fdCode).map((c) => c.slug);
  }

  async getMatches(competitionSlug: string, from?: string, to?: string): Promise<ProviderMatch[]> {
    const competition = this.competition(competitionSlug);
    const range = from && to ? `?dateFrom=${from}&dateTo=${to}` : '';
    const body = await this.http.get<{ matches: FdMatch[] }>(
      `/competitions/${competition.fdCode}/matches${range}`,
    );
    return body.matches.map((m) => mapMatch(m, competition));
  }

  async getStandings(competitionSlug: string): Promise<ProviderStandings | null> {
    const competition = this.competition(competitionSlug);
    const body = await this.http.get<FdStandingsResponse>(
      `/competitions/${competition.fdCode}/standings`,
    );
    return mapStandings(body, competition);
  }

  async getScorers(
    competitionSlug: string,
  ): Promise<{ season: ProviderSeason; scorers: ProviderScorer[] } | null> {
    const competition = this.competition(competitionSlug);
    const body = await this.http.get<FdScorersResponse>(
      `/competitions/${competition.fdCode}/scorers?limit=20`,
    );
    return mapScorers(body, competition);
  }

  async getLive(): Promise<ProviderMatch[]> {
    const body = await this.http.get<{ matches: FdMatch[] }>('/matches?status=IN_PLAY,PAUSED');
    return this.mapTracked(body.matches);
  }

  async getByDate(date: string): Promise<ProviderMatch[]> {
    const body = await this.http.get<{ matches: FdMatch[] }>(
      `/matches?dateFrom=${date}&dateTo=${addDays(date, 1)}`,
    );
    return this.mapTracked(body.matches).filter(
      (m) => m.kickoffAt.toISOString().slice(0, 10) === date,
    );
  }

  async getDetails(externalId: string): Promise<ProviderMatchDetails | null> {
    const m = await this.http.get<FdMatch>(`/matches/${encodeURIComponent(externalId)}`);
    const competition = trackedByFootballDataCode(m.competition.code);
    return competition ? { match: mapMatch(m, competition) } : null;
  }

  private mapTracked(matches: FdMatch[]): ProviderMatch[] {
    return matches.flatMap((m) => {
      const competition = trackedByFootballDataCode(m.competition.code);
      return competition ? [mapMatch(m, competition)] : [];
    });
  }

  private competition(slug: string) {
    const competition = TRACKED_COMPETITIONS.find((c) => c.slug === slug && c.fdCode);
    if (!competition) throw new Error(`football-data.org does not cover ${slug}`);
    return competition;
  }
}
