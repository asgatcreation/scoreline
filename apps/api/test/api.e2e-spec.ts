import { readFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventType, MatchStatus, Side } from '@scoreline/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { trackedByFootballDataCode } from '../src/football/competitions.js';
import { SyncService } from '../src/ingest/sync.service.js';
import {
  type FdMatch,
  type FdScorersResponse,
  type FdStandingsResponse,
  mapMatch,
  mapScorers,
  mapStandings,
} from '../src/providers/football-data/football-data.mappers.js';
import { hasTestDb, resetDb } from './db.js';

const load = <T>(name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T;
const pl = trackedByFootballDataCode('PL')!;

describe.skipIf(!hasTestDb)('REST API (database)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    http = request(app.getHttpServer());

    const prisma = app.get(PrismaService);
    const sync = app.get(SyncService);
    await resetDb(prisma);
    await sync.ensureCompetitions();
    const fixtures = load<{ matches: FdMatch[] }>('fd-matches.json').matches.map((m) =>
      mapMatch(m, pl),
    );
    await sync.syncMatches('FOOTBALL_DATA', 'season', fixtures);
    await sync.saveStandings(
      'FOOTBALL_DATA',
      mapStandings(load<FdStandingsResponse>('fd-standings.json'), pl),
    );
    await sync.saveScorers(
      'FOOTBALL_DATA',
      'premier-league',
      mapScorers(load<FdScorersResponse>('fd-scorers.json'), pl),
    );
    // Arsenal v Leeds goes live with a goal.
    const arsenalLeeds = fixtures.find((m) => m.home.name === 'Arsenal FC')!;
    await sync.syncMatches('API_FOOTBALL', 'live', [
      {
        ...arsenalLeeds,
        externalId: 'af-1',
        home: { externalId: '42', name: 'Arsenal' },
        away: { externalId: '63', name: 'Leeds' },
        status: MatchStatus.SecondHalf,
        minute: 64,
        score: { home: 1, away: 0 },
        halfTime: { home: 0, away: 0 },
        events: [
          {
            key: 'g1',
            type: EventType.Goal,
            side: Side.Home,
            minute: 52,
            playerName: 'Bukayo Saka',
          },
        ],
      },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists a day of matches grouped by competition, in Lagos time', async () => {
    const res = await http.get('/v1/matches?date=2026-10-10&tz=Africa/Lagos').expect(200);
    expect(res.body.timezone).toBe('Africa/Lagos');
    const group = res.body.groups.find(
      (g: { competition: { slug: string } }) => g.competition.slug === 'premier-league',
    );
    expect(group.matches[0]).toMatchObject({
      slug: 'arsenal-vs-leeds-united-2026-10-10',
      status: 'SECOND_HALF',
      minute: 64,
      score: { home: 1, away: 0 },
      home: { name: 'Arsenal FC', tla: 'ARS' },
    });
  });

  it('filters by status', async () => {
    const live = await http.get('/v1/matches?date=2026-10-10&status=live').expect(200);
    const slugs = live.body.groups.flatMap((g: { matches: { slug: string }[] }) =>
      g.matches.map((m) => m.slug),
    );
    expect(slugs).toEqual(['arsenal-vs-leeds-united-2026-10-10']);
  });

  it('includes real live matches in the live list', async () => {
    const res = await http.get('/v1/matches/live').expect(200);
    expect(res.body.matches.filter((m: { isDemo: boolean }) => !m.isDemo)).toHaveLength(1);
  });

  it('serves a match page with events and change history', async () => {
    const res = await http.get('/v1/matches/arsenal-vs-leeds-united-2026-10-10').expect(200);
    expect(res.body.events).toEqual([
      expect.objectContaining({ type: 'GOAL', playerName: 'Bukayo Saka', minute: 52 }),
    ]);
    expect(res.body.halfTime).toEqual({ home: 0, away: 0 });

    const updates = await http.get(`/v1/matches/${res.body.id}/updates?since=1`).expect(200);
    expect(updates.body.seq).toBe(res.body.seq);
    expect(updates.body.updates.map((u: { seq: number }) => u.seq)[0]).toBe(2);
  });

  it('serves the table with zones, and top scorers', async () => {
    const table = await http.get('/v1/competitions/premier-league/standings').expect(200);
    const rows = table.body.tables[0].rows;
    expect(rows[0]).toMatchObject({ position: 1, points: 15, zone: 'champions-league' });
    expect(rows[0].team.name).toBe('Manchester City FC');

    const scorers = await http.get('/v1/competitions/premier-league/scorers').expect(200);
    expect(scorers.body.scorers[0]).toMatchObject({ rank: 1, playerName: 'Erling Haaland' });
  });

  it('serves a team page', async () => {
    const res = await http.get('/v1/teams/arsenal').expect(200);
    expect(res.body).toMatchObject({ name: 'Arsenal FC', tla: 'ARS' });
    expect(res.body.competitions.map((c: { slug: string }) => c.slug)).toContain('premier-league');
    expect(res.body.upcoming.length).toBeGreaterThan(0);
  });

  it('searches teams and competitions', async () => {
    const res = await http.get('/v1/search?q=premier').expect(200);
    expect(res.body.competitions[0].slug).toBe('premier-league');
    const teams = await http.get('/v1/search?q=ars').expect(200);
    expect(teams.body.teams.map((t: { name: string }) => t.name)).toContain('Arsenal FC');
  });

  it('serves demo matches and the demo table without the database', async () => {
    const comps = await http.get('/v1/competitions').expect(200);
    expect(comps.body.competitions.at(-1)).toMatchObject({
      slug: 'scoreline-demo-league',
      isDemo: true,
    });
    const table = await http.get('/v1/competitions/scoreline-demo-league/standings').expect(200);
    expect(table.body.tables[0].rows).toHaveLength(10);
  });

  it('rejects bad input with clear messages', async () => {
    const bad = await http.get('/v1/matches?date=2026-13-01').expect(400);
    expect(bad.body.message).toMatch(/date/);
    await http.get('/v1/matches?tz=Nowhere/City').expect(400);
    await http.get('/v1/matches/DROP%20TABLE').expect(400);
    await http.get('/v1/matches/no-such-match').expect(404);
    await http.get('/v1/competitions/nope/standings').expect(200, { tables: [] });
    await http.get('/v1/teams/no-such-team').expect(404);
  });
});
