import { readFileSync } from 'node:fs';
import { EventType, MatchStatus, Side } from '@scoreline/shared';
import { trackedByApiFootballId } from '../../football/competitions.js';
import {
  type AfFixture,
  mapDetails,
  mapEvents,
  mapFixture,
  mapStatus,
} from './api-football.mappers.js';
import { ApiFootballProvider } from './api-football.provider.js';

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), 'utf8')) as {
    response: AfFixture[];
  };

const brasileirao = trackedByApiFootballId(71)!;

describe('API-Football mappers', () => {
  it('maps statuses, including AET/PEN as finished', () => {
    expect(mapStatus('NS', null)).toBe(MatchStatus.Scheduled);
    expect(mapStatus('1H', 12)).toBe(MatchStatus.FirstHalf);
    expect(mapStatus('HT', 45)).toBe(MatchStatus.HalfTime);
    expect(mapStatus('P', 120)).toBe(MatchStatus.Penalties);
    expect(mapStatus('AET', 120)).toBe(MatchStatus.Finished);
    expect(mapStatus('PEN', 120)).toBe(MatchStatus.Finished);
    expect(mapStatus('PST', null)).toBe(MatchStatus.Postponed);
    expect(mapStatus('LIVE', 70)).toBe(MatchStatus.SecondHalf);
  });

  it('maps a finished fixture with full details (real sample)', () => {
    const raw = load('af-fixture-detail.json').response[0]!;
    const { match, lineups, stats } = mapDetails(raw, brasileirao);

    expect(match.competitionSlug).toBe('brasileirao');
    expect(match.home.name).toBe('Cruzeiro');
    expect(match.status).toBe(MatchStatus.Finished);
    expect(match.score).toEqual({ home: 2, away: 0 });
    expect(match.halfTime).toEqual({ home: 1, away: 0 });
    expect(match.penalties).toBeNull();
    expect(match.matchday).toBe(29);

    const goals = match.events!.filter((e) => e.type === EventType.Goal);
    expect(goals.map((g) => [g.minute, g.playerName, g.assistName, g.side])).toEqual([
      [44, 'Kaio Jorge', 'Matheus Pereira', Side.Home],
      [57, 'Zé Lucas', null, Side.Home],
    ]);

    // Zé Lucas came on at 45' (then scored at 57'), so he is playerName.
    const firstSub = match.events!.find((e) => e.type === EventType.Substitution)!;
    expect(firstSub.playerName).toBe('Zé Lucas');
    expect(firstSub.assistName).toBe('Lucas Romer');

    expect(lineups).toHaveLength(2);
    expect(lineups![0]!.formation).toBe('4-2-3-1');
    expect(lineups![0]!.players.filter((p) => p.isStarter)).toHaveLength(11);

    const possession = stats!.find((s) => s.type === 'possession')!;
    expect(possession.unit).toBe('%');
    expect(possession.home! + possession.away!).toBe(100);
  });

  it('gives every event a unique, stable key', () => {
    const raw = load('af-fixture-detail.json').response[0]!;
    const a = mapFixture(raw, brasileirao).events!.map((e) => e.key);
    const b = mapFixture(raw, brasileirao).events!.map((e) => e.key);
    expect(new Set(a).size).toBe(a.length);
    expect(a).toEqual(b);
  });

  it('credits an own goal to the side that benefits', () => {
    const ownGoal = {
      time: { elapsed: 30, extra: null },
      team: { id: 1 },
      player: { id: 9, name: 'Unlucky Defender' },
      assist: { id: null, name: null },
      type: 'Goal',
      detail: 'Own Goal',
    };
    // Home defender (team 1) scores into his own net: away leads 0-1.
    const [event] = mapEvents([ownGoal], 1, { home: 0, away: 1 });
    expect(event!.type).toBe(EventType.OwnGoal);
    expect(event!.side).toBe(Side.Away);
  });

  it('reads the live minute and stoppage time', () => {
    const live = load('af-live.json').response[0]!;
    const georgia = { ...brasileirao, slug: 'test' };
    const match = mapFixture(live, georgia);
    expect(match.status).toBe(MatchStatus.FirstHalf);
    expect(match.minute).toBe(44);
    expect(match.periodStartedAt).toEqual(new Date(live.fixture.periods.first! * 1000));
    expect(match.events).toHaveLength(1);
  });
});

describe('ApiFootballProvider', () => {
  const fixtures = load('af-by-date.json');

  it('asks for live matches in tracked competitions only', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ errors: [], results: 0, response: [] }));
    const provider = new ApiFootballProvider('key', 100, undefined, fetchImpl);
    await provider.getLive();
    const url = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(url).toMatch(/\/fixtures\?live=39-2-140-/);
  });

  it('drops competitions we do not track', async () => {
    const fetchImpl = async () => Response.json(fixtures);
    const provider = new ApiFootballProvider('key', 100, undefined, fetchImpl);
    const matches = await provider.getByDate('2026-10-08');
    const tracked = fixtures.response.filter((f) => trackedByApiFootballId(f.league.id));
    expect(matches).toHaveLength(tracked.length);
  });

  it('treats an error body as a failure', async () => {
    const fetchImpl = async () =>
      Response.json({
        errors: { plan: 'Free plans do not have access to this date' },
        response: [],
      });
    const provider = new ApiFootballProvider('key', 100, undefined, fetchImpl);
    await expect(provider.getByDate('2026-01-01')).rejects.toMatchObject({ kind: 'plan' });
  });
});
