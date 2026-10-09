import { Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import {
  type CompetitionDetail,
  type CompetitionGroup,
  type CompetitionRef,
  type LineupDto,
  type MatchDetail,
  MatchStatus,
  type MatchSummary,
  type MatchesByDayResponse,
  type SearchResult,
  type StandingsTable,
  type TeamDetail,
  type TopScorerRow,
  isEnded,
  isLive,
  localDate,
  localDayRange,
} from '@scoreline/shared';
import type { Subscription } from 'rxjs';
import { PrismaService } from '../database/prisma.service.js';
import { DEMO_COMPETITION_REF, DemoService } from '../demo/demo.service.js';
import { ChangeBus } from '../ingest/change-bus.js';
import { DEMO_COMPETITION } from './competitions.js';
import {
  matchSummaryInclude,
  toCompetitionRef,
  toEventDto,
  toMatchSummary,
  toTeamRef,
} from './serializers.js';
import { TtlCache } from './ttl-cache.js';
import { zoneFor } from './zones.js';

const HOUR = 3_600_000;
const LIVE_STATUSES = [
  MatchStatus.FirstHalf,
  MatchStatus.HalfTime,
  MatchStatus.SecondHalf,
  MatchStatus.ExtraTime,
  MatchStatus.BreakExtraTime,
  MatchStatus.Penalties,
];

export type StatusFilter = 'all' | 'live' | 'finished' | 'upcoming';

/** Read side of the API: database matches merged with demo matches. */
@Injectable()
export class FootballQueryService implements OnModuleDestroy {
  private readonly cache = new TtlCache();
  private readonly sub: Subscription;

  constructor(
    private readonly prisma: PrismaService,
    private readonly demo: DemoService,
    bus: ChangeBus,
  ) {
    // Demo changes are computed on the fly, so only real changes clear the cache.
    this.sub = bus.changes$.subscribe((b) => {
      if (!b.isDemo) this.cache.clear();
    });
  }

  onModuleDestroy(): void {
    this.sub.unsubscribe();
  }

  // ---------------------------------------------------------------------
  // Matches
  // ---------------------------------------------------------------------

  async matchesByDay(
    date: string,
    timezone: string,
    status: StatusFilter,
  ): Promise<MatchesByDayResponse> {
    const { start, end } = localDayRange(date, timezone);
    const real = await this.cache.get(`day:${start.toISOString()}`, 15_000, async () =>
      (
        await this.prisma.match.findMany({
          where: { kickoffAt: { gte: start, lt: end } },
          include: matchSummaryInclude,
          orderBy: [{ competition: { priority: 'asc' } }, { kickoffAt: 'asc' }, { id: 'asc' }],
        })
      ).map(toMatchSummary),
    );

    // Demo matches only appear around "now", so they never crowd the list.
    const now = Date.now();
    const isToday = localDate(new Date(now), timezone) === date;
    const demo =
      this.demo.enabled && isToday
        ? this.demo.matchesBetween(now - 3 * HOUR, now + 2 * HOUR, now)
        : [];

    const matches = [...real, ...demo].filter((m) => matchesStatus(m, status));
    return { date, timezone, groups: groupByCompetition(matches) };
  }

  /** Just the summary (cheap), for real-time catch-up after a reconnect. */
  async summaryById(matchId: string): Promise<MatchSummary | null> {
    if (matchId.startsWith('demo-')) {
      const demo = this.demo.enabled ? this.demo.find(matchId) : null;
      if (!demo) return null;
      const { venue, referee, attendance, events, lineups, stats, headToHead, ...summary } = demo;
      void [venue, referee, attendance, events, lineups, stats, headToHead];
      return summary;
    }
    const row = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: matchSummaryInclude,
    });
    return row ? toMatchSummary(row) : null;
  }

  async liveMatches(): Promise<MatchSummary[]> {
    const real = await this.cache.get('live', 10_000, async () =>
      (
        await this.prisma.match.findMany({
          where: { status: { in: LIVE_STATUSES } },
          include: matchSummaryInclude,
          orderBy: [{ competition: { priority: 'asc' } }, { kickoffAt: 'asc' }],
        })
      ).map(toMatchSummary),
    );
    return [...real, ...(this.demo.enabled ? this.demo.live() : [])];
  }

  async matchDetail(idOrSlug: string): Promise<MatchDetail> {
    if (idOrSlug.startsWith('demo-')) {
      const demo = this.demo.enabled ? this.demo.find(idOrSlug) : null;
      if (!demo) throw new NotFoundException('Match not found');
      return demo;
    }
    return this.cache.get(`match:${idOrSlug}`, 10_000, async () => {
      const m = await this.prisma.match.findFirst({
        where: { OR: [{ slug: idOrSlug }, { id: idOrSlug }] },
        include: {
          ...matchSummaryInclude,
          venue: true,
          events: { orderBy: [{ minute: 'asc' }, { extraMinute: 'asc' }, { createdAt: 'asc' }] },
          lineups: { include: { players: { orderBy: { order: 'asc' } } } },
          stats: true,
        },
      });
      if (!m) throw new NotFoundException('Match not found');
      const h2h = await this.prisma.match.findMany({
        where: {
          id: { not: m.id },
          status: MatchStatus.Finished,
          OR: [
            { homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId },
            { homeTeamId: m.awayTeamId, awayTeamId: m.homeTeamId },
          ],
        },
        include: matchSummaryInclude,
        orderBy: { kickoffAt: 'desc' },
        take: 5,
      });
      return {
        ...toMatchSummary(m),
        venue: m.venue ? { name: m.venue.name, city: m.venue.city } : null,
        referee: m.referee,
        attendance: m.attendance,
        events: m.events.map(toEventDto),
        lineups: m.lineups
          .sort((a, b) => (a.side === 'HOME' ? -1 : b.side === 'HOME' ? 1 : 0))
          .map((l): LineupDto => ({
            side: l.side as LineupDto['side'],
            formation: l.formation,
            coachName: l.coachName,
            players: l.players.map((p) => ({
              name: p.name,
              number: p.number,
              position: p.position,
              grid: p.grid,
              isStarter: p.isStarter,
            })),
          })),
        stats: m.stats.map((s) => ({
          type: s.type,
          home: s.homeValue,
          away: s.awayValue,
          unit: s.unit,
        })),
        headToHead: h2h.map(toMatchSummary),
      };
    });
  }

  /** Stored changes after `sinceSeq`, for clients catching up after a reconnect. */
  async matchUpdates(idOrSlug: string, sinceSeq: number) {
    const match = await this.prisma.match.findFirst({
      where: { OR: [{ slug: idOrSlug }, { id: idOrSlug }] },
      select: { id: true, seq: true },
    });
    if (!match) throw new NotFoundException('Match not found');
    const updates = await this.prisma.matchUpdate.findMany({
      where: { matchId: match.id, seq: { gt: sinceSeq } },
      orderBy: { seq: 'asc' },
      take: 200,
    });
    return {
      matchId: match.id,
      seq: match.seq,
      updates: updates.map((u) => ({
        seq: u.seq,
        type: u.type,
        change: u.payload,
        at: u.createdAt.toISOString(),
      })),
    };
  }

  // ---------------------------------------------------------------------
  // Competitions
  // ---------------------------------------------------------------------

  async competitions(): Promise<CompetitionRef[]> {
    const rows = await this.cache.get('competitions', 60_000, () =>
      this.prisma.competition.findMany({ orderBy: { priority: 'asc' } }),
    );
    return [...rows.map(toCompetitionRef), ...(this.demo.enabled ? [DEMO_COMPETITION_REF] : [])];
  }

  async competition(slug: string): Promise<CompetitionDetail> {
    if (slug === DEMO_COMPETITION.slug && this.demo.enabled) {
      return { ...DEMO_COMPETITION_REF, type: 'LEAGUE', season: null };
    }
    const c = await this.prisma.competition.findUnique({
      where: { slug },
      include: { seasons: { where: { isCurrent: true }, take: 1 } },
    });
    if (!c) throw new NotFoundException('Competition not found');
    const season = c.seasons[0];
    return {
      ...toCompetitionRef(c),
      type: c.type,
      season: season ? { year: season.year, currentMatchday: season.currentMatchday } : null,
    };
  }

  async standings(slug: string): Promise<StandingsTable[]> {
    if (slug === DEMO_COMPETITION.slug && this.demo.enabled) {
      return [{ group: '', rows: this.demo.standings() }];
    }
    return this.cache.get(`standings:${slug}`, 120_000, async () => {
      const season = await this.currentSeason(slug);
      if (!season) return [];
      const rows = await this.prisma.standing.findMany({
        where: { seasonId: season.id },
        include: { team: true },
        orderBy: [{ group: 'asc' }, { position: 'asc' }],
      });
      const form = await this.recentForm(
        season.competitionId,
        rows.map((r) => r.teamId),
      );
      const groups = new Map<string, StandingsTable>();
      for (const r of rows) {
        const table = groups.get(r.group) ?? { group: r.group, rows: [] };
        groups.set(r.group, table);
        table.rows.push({
          position: r.position,
          team: toTeamRef(r.team),
          played: r.played,
          won: r.won,
          drawn: r.drawn,
          lost: r.lost,
          goalsFor: r.goalsFor,
          goalsAgainst: r.goalsAgainst,
          goalDiff: r.goalDiff,
          points: r.points,
          form: r.form ?? form.get(r.teamId) ?? null,
          zone: null,
        });
      }
      for (const table of groups.values()) {
        for (const row of table.rows) {
          row.zone = table.group ? null : zoneFor(slug, row.position, table.rows.length);
        }
      }
      return [...groups.values()];
    });
  }

  async competitionMatches(slug: string, opts: { matchday?: number; from?: string; to?: string }) {
    if (slug === DEMO_COMPETITION.slug && this.demo.enabled) {
      const now = Date.now();
      return this.demo.matchesBetween(now - 24 * HOUR, now + 24 * HOUR, now);
    }
    const c = await this.prisma.competition.findUnique({ where: { slug }, select: { id: true } });
    if (!c) throw new NotFoundException('Competition not found');
    const season = await this.currentSeason(slug);
    let where;
    if (opts.matchday !== undefined) {
      where = {
        competitionId: c.id,
        matchday: opts.matchday,
        ...(season ? { seasonId: season.id } : {}),
      };
    } else {
      // Default: a week either side of today.
      const from = opts.from
        ? new Date(`${opts.from}T00:00:00Z`)
        : new Date(Date.now() - 7 * 24 * HOUR);
      const to = opts.to ? new Date(`${opts.to}T23:59:59Z`) : new Date(Date.now() + 7 * 24 * HOUR);
      where = { competitionId: c.id, kickoffAt: { gte: from, lte: to } };
    }
    const rows = await this.prisma.match.findMany({
      where,
      include: matchSummaryInclude,
      orderBy: { kickoffAt: 'asc' },
      take: 400,
    });
    return rows.map(toMatchSummary);
  }

  async scorers(slug: string): Promise<TopScorerRow[]> {
    const season = await this.currentSeason(slug);
    if (!season) return [];
    const rows = await this.prisma.topScorer.findMany({
      where: { seasonId: season.id },
      include: { team: true },
      orderBy: [{ rank: 'asc' }, { goals: 'desc' }],
      take: 20,
    });
    return rows.map((r) => ({
      rank: r.rank,
      playerName: r.playerName,
      team: toTeamRef(r.team),
      goals: r.goals,
      assists: r.assists,
      penalties: r.penalties,
      played: r.played,
    }));
  }

  private currentSeason(slug: string) {
    return this.prisma.season.findFirst({
      where: { competition: { slug } },
      orderBy: [{ isCurrent: 'desc' }, { year: 'desc' }],
    });
  }

  /** Last five results per team in a competition, oldest first ("WWDLW"). */
  private async recentForm(competitionId: string, teamIds: string[]): Promise<Map<string, string>> {
    const matches = await this.prisma.match.findMany({
      where: {
        competitionId,
        status: MatchStatus.Finished,
        OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }],
      },
      select: { homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
      orderBy: { kickoffAt: 'desc' },
      take: teamIds.length * 5,
    });
    const form = new Map<string, string[]>();
    for (const m of matches) {
      for (const [team, mine, theirs] of [
        [m.homeTeamId, m.homeScore, m.awayScore],
        [m.awayTeamId, m.awayScore, m.homeScore],
      ] as const) {
        const list = form.get(team) ?? [];
        if (list.length < 5 && mine !== null && theirs !== null) {
          list.unshift(mine > theirs ? 'W' : mine === theirs ? 'D' : 'L');
          form.set(team, list);
        }
      }
    }
    return new Map([...form].map(([team, list]) => [team, list.join('')]));
  }

  // ---------------------------------------------------------------------
  // Teams and search
  // ---------------------------------------------------------------------

  async team(slug: string): Promise<TeamDetail> {
    const demoTeam = this.demo.enabled ? this.demo.teams().find((t) => t.slug === slug) : undefined;
    if (demoTeam) return this.demoTeam(demoTeam.slug);

    return this.cache.get(`team:${slug}`, 60_000, async () => {
      const t = await this.prisma.team.findUnique({
        where: { slug },
        include: { venue: true, squad: true },
      });
      if (!t) throw new NotFoundException('Team not found');
      const teamMatch = { OR: [{ homeTeamId: t.id }, { awayTeamId: t.id }] };
      const [recent, upcoming, competitions] = await Promise.all([
        this.prisma.match.findMany({
          where: { ...teamMatch, status: MatchStatus.Finished },
          include: matchSummaryInclude,
          orderBy: { kickoffAt: 'desc' },
          take: 10,
        }),
        this.prisma.match.findMany({
          where: {
            ...teamMatch,
            status: { notIn: [MatchStatus.Finished, MatchStatus.Cancelled, MatchStatus.Abandoned] },
          },
          include: matchSummaryInclude,
          orderBy: { kickoffAt: 'asc' },
          take: 10,
        }),
        this.prisma.competition.findMany({
          where: {
            OR: [
              { matches: { some: teamMatch } },
              { seasons: { some: { standings: { some: { teamId: t.id } } } } },
            ],
          },
          orderBy: { priority: 'asc' },
        }),
      ]);
      const summaries = recent.map(toMatchSummary);
      return {
        ...toTeamRef(t),
        country: t.country,
        founded: t.founded,
        isNational: t.isNational,
        venue: t.venue ? { name: t.venue.name, city: t.venue.city } : null,
        competitions: competitions.map(toCompetitionRef),
        form: formFor(t.id, summaries),
        recent: summaries,
        upcoming: upcoming.map(toMatchSummary),
        squad: t.squad.map((p) => ({
          name: p.name,
          position: p.position,
          shirtNumber: p.shirtNumber,
        })),
      };
    });
  }

  private demoTeam(slug: string): TeamDetail {
    const now = Date.now();
    const ref = this.demo.teams().find((t) => t.slug === slug)!;
    const around = this.demo.matchesBetween(now - 3 * 24 * HOUR, now + 24 * HOUR, now);
    const mine = around.filter((m) => m.home.slug === slug || m.away.slug === slug);
    const recent = mine
      .filter((m) => isEnded(m.status))
      .reverse()
      .slice(0, 10);
    return {
      ...ref,
      country: null,
      founded: null,
      isNational: false,
      venue: null,
      competitions: [DEMO_COMPETITION_REF],
      form: formFor(ref.id, recent),
      recent,
      upcoming: mine.filter((m) => !isEnded(m.status)).slice(0, 10),
      squad: [],
    };
  }

  async search(q: string): Promise<SearchResult> {
    const term = q.trim();
    const [teams, competitions] = await Promise.all([
      this.prisma.team.findMany({
        where: {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { shortName: { contains: term, mode: 'insensitive' } },
            { tla: { equals: term.toUpperCase() } },
          ],
        },
        orderBy: [{ isNational: 'asc' }, { name: 'asc' }],
        take: 8,
      }),
      this.prisma.competition.findMany({
        where: {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { shortName: { contains: term, mode: 'insensitive' } },
            { country: { contains: term, mode: 'insensitive' } },
          ],
        },
        orderBy: { priority: 'asc' },
        take: 5,
      }),
    ]);
    const lower = term.toLowerCase();
    const demoTeams = this.demo.enabled
      ? this.demo
          .teams()
          .filter((t) => t.name.toLowerCase().includes(lower))
          .slice(0, 3)
      : [];
    return {
      teams: [...teams.map(toTeamRef), ...demoTeams],
      competitions: competitions.map(toCompetitionRef),
    };
  }
}

function matchesStatus(m: MatchSummary, status: StatusFilter): boolean {
  switch (status) {
    case 'live':
      return isLive(m.status);
    case 'finished':
      return isEnded(m.status);
    case 'upcoming':
      return !isLive(m.status) && !isEnded(m.status);
    default:
      return true;
  }
}

function groupByCompetition(matches: MatchSummary[]): CompetitionGroup[] {
  const groups = new Map<string, CompetitionGroup>();
  for (const m of matches) {
    const g = groups.get(m.competition.id) ?? { competition: m.competition, matches: [] };
    groups.set(m.competition.id, g);
    g.matches.push(m);
  }
  return [...groups.values()];
}

function formFor(teamId: string, recent: MatchSummary[]): ('W' | 'D' | 'L')[] {
  return recent
    .slice(0, 5)
    .reverse()
    .flatMap((m) => {
      const home = m.home.id === teamId;
      const mine = home ? m.score.home : m.score.away;
      const theirs = home ? m.score.away : m.score.home;
      if (mine === null || theirs === null) return [];
      return [mine > theirs ? 'W' : mine === theirs ? 'D' : 'L'] as const;
    });
}
