import { readFileSync } from 'node:fs';
import { MatchStatus } from '@scoreline/shared';
import { trackedByFootballDataCode } from '../../football/competitions.js';
import {
  type FdMatch,
  type FdScorersResponse,
  type FdStandingsResponse,
  mapMatch,
  mapScorers,
  mapStandings,
  mapStatus,
} from './football-data.mappers.js';
import { FootballDataProvider } from './football-data.provider.js';

const load = <T>(name: string) =>
  JSON.parse(readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), 'utf8')) as T;

const pl = trackedByFootballDataCode('PL')!;

describe('football-data.org mappers', () => {
  it('maps the real Premier League table', () => {
    const table = mapStandings(load<FdStandingsResponse>('fd-standings.json'), pl);
    expect(table.season.year).toBe(2026);
    expect(table.season.currentMatchday).toBe(6);
    const top = table.rows[0]!;
    expect(top.group).toBe('');
    expect(top.team).toMatchObject({
      name: 'Manchester City FC',
      shortName: 'Man City',
      tla: 'MCI',
    });
    expect(top.points).toBe(15);
    expect(top.drawn).toBe(0);
  });

  it('maps a scheduled fixture', () => {
    const raw = load<{ matches: FdMatch[] }>('fd-matches.json').matches[0]!;
    const match = mapMatch(raw, pl);
    expect(match.status).toBe(MatchStatus.Scheduled);
    expect(match.home.name).toBe('Arsenal FC');
    expect(match.kickoffAt.toISOString()).toBe('2026-10-10T11:30:00.000Z');
    expect(match.round).toBe('Matchday 6');
    expect(match.score).toEqual({ home: null, away: null });
    expect(match.events).toBeUndefined();
  });

  it('separates penalties from the real score after a shoot-out', () => {
    const raw = load<{ matches: FdMatch[] }>('fd-matches.json').matches[0]!;
    const shootout: FdMatch = {
      ...raw,
      status: 'FINISHED',
      score: {
        duration: 'PENALTY_SHOOTOUT',
        fullTime: { home: 5, away: 4 },
        halfTime: { home: 0, away: 1 },
        regularTime: { home: 1, away: 1 },
        extraTime: { home: 0, away: 0 },
        penalties: { home: 4, away: 3 },
      },
    };
    const match = mapMatch(shootout, pl);
    expect(match.score).toEqual({ home: 1, away: 1 });
    expect(match.penalties).toEqual({ home: 4, away: 3 });
  });

  it('guesses the half for in-play matches', () => {
    const ko = new Date('2026-10-10T11:30:00Z');
    expect(mapStatus('IN_PLAY', ko, new Date('2026-10-10T11:50:00Z'))).toBe(MatchStatus.FirstHalf);
    expect(mapStatus('IN_PLAY', ko, new Date('2026-10-10T12:50:00Z'))).toBe(MatchStatus.SecondHalf);
    expect(mapStatus('PAUSED', ko)).toBe(MatchStatus.HalfTime);
  });

  it('maps top scorers', () => {
    const { scorers } = mapScorers(load<FdScorersResponse>('fd-scorers.json'), pl);
    expect(scorers[0]).toMatchObject({ playerName: 'Erling Haaland', goals: 5 });
    expect(scorers[0]!.team.tla).toBe('MCI');
  });
});

describe('FootballDataProvider', () => {
  it('lists only competitions it covers and rejects others', async () => {
    const provider = new FootballDataProvider('t', 10, undefined, async () => Response.json({}));
    expect(provider.competitions()).toContain('premier-league');
    expect(provider.competitions()).not.toContain('npfl');
    await expect(provider.getStandings('npfl')).rejects.toThrow(/does not cover/);
  });

  it('sends the auth header and the date range', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ matches: [] }));
    const provider = new FootballDataProvider('token-123', 10, undefined, fetchImpl);
    await provider.getMatches('premier-league', '2026-10-01', '2026-10-31');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://api.football-data.org/v4/competitions/PL/matches?dateFrom=2026-10-01&dateTo=2026-10-31',
    );
    expect(init.headers).toEqual({ 'X-Auth-Token': 'token-123' });
  });
});

describe('FootballDataProvider missing data', () => {
  it('returns null for a table that does not exist, without backing off', async () => {
    const provider = new FootballDataProvider('t', 10, undefined, async () =>
      Response.json({ message: 'Not found' }, { status: 404 }),
    );
    await expect(provider.getStandings('world-cup')).resolves.toBeNull();
    await expect(provider.getScorers('world-cup')).resolves.toBeNull();
    expect(provider.http.quota.waitMs()).toBe(0);
  });
});
