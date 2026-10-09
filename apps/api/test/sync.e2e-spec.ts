import { readFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { EventType, MatchStatus, Side } from '@scoreline/shared';
import { DatabaseModule } from '../src/database/database.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { trackedByFootballDataCode } from '../src/football/competitions.js';
import { ChangeBus, type MatchChangeBatch } from '../src/ingest/change-bus.js';
import { SyncService } from '../src/ingest/sync.service.js';
import {
  type FdMatch,
  type FdScorersResponse,
  type FdStandingsResponse,
  mapMatch,
  mapScorers,
  mapStandings,
} from '../src/providers/football-data/football-data.mappers.js';
import type { ProviderMatch } from '../src/providers/types.js';
import { hasTestDb, resetDb } from './db.js';

const load = <T>(name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T;

const pl = trackedByFootballDataCode('PL')!;
const fdMatches = load<{ matches: FdMatch[] }>('fd-matches.json').matches.map((m) =>
  mapMatch(m, pl),
);
const arsenalLeedsFd = fdMatches.find((m) => m.home.name === 'Arsenal FC')!;

/** The same fixture as API-Football reports it: other ids, shorter names. */
function arsenalLeedsAf(over: Partial<ProviderMatch> = {}): ProviderMatch {
  return {
    externalId: 'af-1234',
    competitionSlug: 'premier-league',
    seasonYear: 2026,
    home: { externalId: '42', name: 'Arsenal', crestUrl: 'https://media.example/42.png' },
    away: { externalId: '63', name: 'Leeds', crestUrl: 'https://media.example/63.png' },
    kickoffAt: arsenalLeedsFd.kickoffAt,
    status: MatchStatus.FirstHalf,
    minute: 23,
    score: { home: 1, away: 0 },
    events: [
      {
        key: 'GOAL|22|0|42|Saka',
        type: EventType.Goal,
        side: Side.Home,
        minute: 22,
        playerName: 'Bukayo Saka',
        assistName: 'Martin Ødegaard',
      },
    ],
    ...over,
  };
}

describe.skipIf(!hasTestDb)('SyncService (database)', () => {
  let prisma: PrismaService;
  let sync: SyncService;
  let published: MatchChangeBatch[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [SyncService, ChangeBus],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    sync = moduleRef.get(SyncService);
    moduleRef.get(ChangeBus).changes$.subscribe((b) => published.push(b));
  });

  beforeEach(async () => {
    await resetDb(prisma);
    published = [];
    await sync.ensureCompetitions();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('stores season fixtures once and changes nothing when re-synced', async () => {
    const first = await sync.syncMatches('FOOTBALL_DATA', 'season', fdMatches);
    expect(first.created).toBe(fdMatches.length);

    const again = await sync.syncMatches('FOOTBALL_DATA', 'season', fdMatches);
    expect(again.created).toBe(0);
    expect(again.changes).toBe(0);
    expect(await prisma.match.count()).toBe(fdMatches.length);

    const arsenal = await prisma.team.findFirstOrThrow({ where: { name: 'Arsenal FC' } });
    expect(arsenal.slug).toBe('arsenal');
    expect(arsenal.tla).toBe('ARS');
  });

  it('links the live feed to the same match and team, then logs the goal', async () => {
    await sync.syncMatches('FOOTBALL_DATA', 'season', fdMatches);
    const result = await sync.syncMatches('API_FOOTBALL', 'live', [arsenalLeedsAf()]);

    expect(result.created).toBe(0);
    expect(await prisma.team.count({ where: { name: { contains: 'Arsenal' } } })).toBe(1);

    const match = await prisma.match.findUniqueOrThrow({
      where: { id: result.matchIds.get('af-1234')! },
      include: { events: true, updates: { orderBy: { seq: 'asc' } } },
    });
    expect(match.slug).toBe('arsenal-vs-leeds-united-2026-10-10');
    expect(match).toMatchObject({ status: 'FIRST_HALF', minute: 23, homeScore: 1, awayScore: 0 });
    expect(match.events[0]).toMatchObject({
      playerName: 'Bukayo Saka',
      type: 'GOAL',
      side: 'HOME',
    });
    expect(match.updates.map((u) => u.type)).toEqual(['status', 'score', 'event']);
    expect(match.seq).toBe(3);

    expect(published).toHaveLength(1);
    expect(published[0]!.summary).toMatchObject({ score: { home: 1, away: 0 }, seq: 3 });
    expect(published[0]!.changes.map((c) => c.type)).toContain('event');
  });

  it('never lets the delayed season feed undo live data', async () => {
    await sync.syncMatches('FOOTBALL_DATA', 'season', fdMatches);
    await sync.syncMatches('API_FOOTBALL', 'live', [
      arsenalLeedsAf({ status: MatchStatus.Finished, minute: null, score: { home: 2, away: 1 } }),
    ]);
    published = [];

    // football-data.org still says "in play, 1-0" a few minutes later.
    await sync.syncMatches('FOOTBALL_DATA', 'season', [
      { ...arsenalLeedsFd, status: MatchStatus.SecondHalf, score: { home: 1, away: 0 } },
    ]);

    const match = await prisma.match.findFirstOrThrow({
      where: { slug: { startsWith: 'arsenal-vs' } },
    });
    expect(match).toMatchObject({ status: 'FINISHED', homeScore: 2, awayScore: 1 });
    expect(match.finalizedAt).not.toBeNull();
    expect(published).toHaveLength(0);
  });

  it('removes a goal that VAR rules out', async () => {
    await sync.syncMatches('API_FOOTBALL', 'live', [arsenalLeedsAf()]);
    await sync.syncMatches('API_FOOTBALL', 'live', [
      arsenalLeedsAf({ minute: 25, score: { home: 0, away: 0 }, events: [] }),
    ]);
    const match = await prisma.match.findFirstOrThrow({ include: { events: true } });
    expect(match.events).toHaveLength(0);
    expect(match.homeScore).toBe(0);
    const last = published.at(-1)!;
    expect(last.changes.map((c) => c.type)).toEqual(['score', 'minute', 'event-removed']);
  });

  it('saves line-ups and stats from match details', async () => {
    const matchId = await sync.saveDetails('API_FOOTBALL', {
      match: arsenalLeedsAf(),
      lineups: [
        {
          side: Side.Home,
          formation: '4-3-3',
          coachName: 'Mikel Arteta',
          players: [{ name: 'David Raya', number: 1, position: 'G', grid: '1:1', isStarter: true }],
        },
      ],
      stats: [{ type: 'possession', home: 61, away: 39, unit: '%' }],
    });
    const match = await prisma.match.findUniqueOrThrow({
      where: { id: matchId! },
      include: { lineups: { include: { players: true } }, stats: true },
    });
    expect(match.lineups[0]).toMatchObject({ formation: '4-3-3', coachName: 'Mikel Arteta' });
    expect(match.lineups[0]!.players[0]!.name).toBe('David Raya');
    expect(match.stats[0]).toMatchObject({ type: 'possession', homeValue: 61, unit: '%' });
    expect(match.detailsSyncedAt).not.toBeNull();
  });

  it('saves the table and top scorers, reusing the same teams', async () => {
    await sync.saveStandings(
      'FOOTBALL_DATA',
      mapStandings(load<FdStandingsResponse>('fd-standings.json'), pl),
    );
    await sync.saveScorers(
      'FOOTBALL_DATA',
      'premier-league',
      mapScorers(load<FdScorersResponse>('fd-scorers.json'), pl),
    );

    const season = await prisma.season.findFirstOrThrow({ where: { isCurrent: true } });
    expect(season.year).toBe(2026);
    const top = await prisma.standing.findFirstOrThrow({
      where: { position: 1 },
      include: { team: true },
    });
    expect(top.team.name).toBe('Manchester City FC');
    const scorer = await prisma.topScorer.findFirstOrThrow({
      where: { rank: 1 },
      include: { team: true },
    });
    expect(scorer).toMatchObject({ playerName: 'Erling Haaland', goals: 5 });
    expect(scorer.teamId).toBe(top.teamId);
  });
});
