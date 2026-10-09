import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { MatchStatus, isEnded, isLive } from '@scoreline/shared';
import { PrismaService } from '../database/prisma.service.js';
import { TRACKED_COMPETITIONS } from '../football/competitions.js';
import { matchSummaryInclude, toMatchSummary } from '../football/serializers.js';
import { matchSlug, slugify, uniqueSlug } from '../football/slug.js';
import type { Prisma } from '../generated/prisma/client.js';
import type {
  ProviderMatch,
  ProviderMatchDetails,
  ProviderName,
  ProviderScorer,
  ProviderSeason,
  ProviderStandings,
  ProviderTeam,
} from '../providers/types.js';
import { ChangeBus } from './change-bus.js';
import {
  type MatchChange,
  type MatchSnapshot,
  type SnapshotEvent,
  diffMatch,
  isPersistedChange,
} from './match-diff.js';
import { findMatchingTeam, normaliseTeamName } from './team-matcher.js';

/**
 * - live:   fast feed (API-Football). Owns status, score, minute, events.
 * - season: slow feed (football-data.org). Owns fixtures and team details;
 *           may only fill in scores the live feed hasn't touched recently,
 *           and never moves a match backwards (its scores are delayed).
 */
export type FeedRole = 'live' | 'season';

export interface SyncResult {
  matchIds: Map<string, string>;
  created: number;
  updated: number;
  changes: number;
}

const LIVE_OWNERSHIP_MS = 30 * 60_000;
const SAME_MATCH_WINDOW_MS = 36 * 60 * 60_000;
const CHUNK = 200;

type ExistingMatch = Prisma.MatchGetPayload<{ include: { events: true } }>;

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private competitionIds = new Map<string, string>();
  private readonly seasonIds = new Map<string, string>();
  private readonly venueIds = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: ChangeBus,
  ) {}

  /** Make sure every tracked competition has a row (cheap; runs at startup). */
  async ensureCompetitions(): Promise<void> {
    await this.prisma.competition.createMany({
      data: TRACKED_COMPETITIONS.map((c) => ({
        slug: c.slug,
        name: c.name,
        shortName: c.shortName,
        country: c.country,
        type: c.type,
        priority: c.priority,
      })),
      skipDuplicates: true,
    });
    const rows = await this.prisma.competition.findMany();
    for (const c of TRACKED_COMPETITIONS) {
      const row = rows.find((r) => r.slug === c.slug);
      if (
        row &&
        (row.name !== c.name || row.priority !== c.priority || row.shortName !== c.shortName)
      ) {
        await this.prisma.competition.update({
          where: { id: row.id },
          data: { name: c.name, priority: c.priority, shortName: c.shortName },
        });
      }
    }
    this.competitionIds = new Map(rows.map((r) => [r.slug, r.id]));
  }

  private async competitionId(slug: string): Promise<string> {
    if (!this.competitionIds.has(slug)) await this.ensureCompetitions();
    const id = this.competitionIds.get(slug);
    if (!id) throw new Error(`Unknown competition ${slug}`);
    return id;
  }

  private async seasonId(
    competitionId: string,
    season: ProviderSeason,
    isCurrent = false,
  ): Promise<string> {
    const key = `${competitionId}:${season.year}`;
    const cached = this.seasonIds.get(key);
    if (cached && !isCurrent) return cached;
    const data = {
      startDate: season.startDate ? new Date(season.startDate) : undefined,
      endDate: season.endDate ? new Date(season.endDate) : undefined,
      currentMatchday: season.currentMatchday ?? undefined,
      ...(isCurrent ? { isCurrent: true } : {}),
    };
    const row = await this.prisma.season.upsert({
      where: { competitionId_year: { competitionId, year: season.year } },
      create: { competitionId, year: season.year, ...data },
      update: data,
    });
    if (isCurrent) {
      await this.prisma.season.updateMany({
        where: { competitionId, id: { not: row.id }, isCurrent: true },
        data: { isCurrent: false },
      });
    }
    this.seasonIds.set(key, row.id);
    return row.id;
  }

  private async venueId(venue: ProviderMatch['venue']): Promise<string | undefined> {
    if (!venue?.name) return undefined;
    const city = venue.city ?? null;
    const key = `${venue.name}|${city ?? ''}`;
    const cached = this.venueIds.get(key);
    if (cached) return cached;
    const existing = await this.prisma.venue.findFirst({ where: { name: venue.name, city } });
    const id =
      existing?.id ?? (await this.prisma.venue.create({ data: { name: venue.name, city } })).id;
    this.venueIds.set(key, id);
    return id;
  }

  // ---------------------------------------------------------------------
  // Teams
  // ---------------------------------------------------------------------

  /**
   * Our team id for every provider team. Order of preference: a remembered
   * ExternalRef, the same club already known in this competition (fuzzy
   * name match), an exact name match anywhere, or a new team.
   */
  async resolveTeams(
    provider: ProviderName,
    teams: { team: ProviderTeam; competitionSlug: string }[],
  ): Promise<Map<string, string>> {
    const unique = new Map<string, { team: ProviderTeam; competitionSlug: string }>();
    for (const t of teams) unique.set(t.team.externalId, t);
    const ids = new Map<string, string>();
    if (unique.size === 0) return ids;

    const refs = await this.prisma.externalRef.findMany({
      where: { provider, entityType: 'TEAM', externalId: { in: [...unique.keys()] } },
    });
    for (const r of refs) ids.set(r.externalId, r.internalId);

    // Keep details fresh from the season feed, which has the best names and crests.
    if (provider === 'FOOTBALL_DATA' && refs.length) {
      const rows = await this.prisma.team.findMany({
        where: { id: { in: refs.map((r) => r.internalId) } },
      });
      for (const row of rows) {
        const ext = refs.find((r) => r.internalId === row.id)!.externalId;
        const t = unique.get(ext)!.team;
        if (
          row.name !== t.name ||
          row.crestUrl !== (t.crestUrl ?? row.crestUrl) ||
          row.tla !== (t.tla ?? row.tla)
        ) {
          await this.prisma.team.update({
            where: { id: row.id },
            data: {
              name: t.name,
              shortName: t.shortName ?? row.shortName,
              tla: t.tla ?? row.tla,
              crestUrl: t.crestUrl ?? row.crestUrl,
            },
          });
        }
      }
    }

    const missing = [...unique.values()].filter((t) => !ids.has(t.team.externalId));
    const byCompetition = new Map<string, typeof missing>();
    for (const t of missing) {
      const list = byCompetition.get(t.competitionSlug) ?? [];
      list.push(t);
      byCompetition.set(t.competitionSlug, list);
    }

    for (const [slug, list] of byCompetition) {
      const competitionId = await this.competitionId(slug);
      const candidates = await this.prisma.team.findMany({
        where: {
          OR: [
            { homeMatches: { some: { competitionId } } },
            { awayMatches: { some: { competitionId } } },
            { standings: { some: { season: { competitionId } } } },
          ],
        },
      });
      // A team already linked to another id of this provider is a different club.
      const taken = new Set(
        (
          await this.prisma.externalRef.findMany({
            where: {
              provider,
              entityType: 'TEAM',
              internalId: { in: candidates.map((c) => c.id) },
            },
            select: { internalId: true },
          })
        ).map((r) => r.internalId),
      );
      const free = candidates.filter((c) => !taken.has(c.id));

      for (const { team } of list) {
        let teamId =
          findMatchingTeam(team, free)?.id ?? (await this.exactNameMatch(provider, team));
        if (teamId) {
          free.splice(
            free.findIndex((c) => c.id === teamId),
            1,
          );
          if (provider === 'FOOTBALL_DATA') {
            await this.prisma.team.update({
              where: { id: teamId },
              data: {
                name: team.name,
                shortName: team.shortName ?? undefined,
                tla: team.tla ?? undefined,
                crestUrl: team.crestUrl ?? undefined,
              },
            });
          }
        } else {
          teamId = await this.createTeam(team);
        }
        await this.prisma.externalRef.createMany({
          data: [{ provider, entityType: 'TEAM', externalId: team.externalId, internalId: teamId }],
          skipDuplicates: true,
        });
        ids.set(team.externalId, teamId);
      }
    }
    return ids;
  }

  private async exactNameMatch(
    provider: ProviderName,
    team: ProviderTeam,
  ): Promise<string | undefined> {
    const wanted = normaliseTeamName(team.name);
    const firstWord = wanted.split(' ')[0];
    if (!firstWord) return undefined;
    const rows = await this.prisma.team.findMany({
      where: {
        isNational: team.isNational ?? false,
        name: { contains: firstWord, mode: 'insensitive' },
      },
      take: 50,
    });
    const same = rows.filter((r) => normaliseTeamName(r.name) === wanted);
    if (same.length !== 1) return undefined;
    const linked = await this.prisma.externalRef.findFirst({
      where: { provider, entityType: 'TEAM', internalId: same[0]!.id },
    });
    return linked ? undefined : same[0]!.id;
  }

  private async createTeam(team: ProviderTeam): Promise<string> {
    const base = slugify(team.name);
    const existing = await this.prisma.team.findMany({
      where: { slug: { startsWith: base } },
      select: { slug: true },
    });
    const taken = new Set(existing.map((t) => t.slug));
    const row = await this.prisma.team.create({
      data: {
        slug: uniqueSlug(base, (s) => taken.has(s)),
        name: team.name,
        shortName: team.shortName ?? null,
        tla: team.tla ?? null,
        crestUrl: team.crestUrl ?? null,
        country: team.country ?? null,
        isNational: team.isNational ?? false,
        primaryColor: team.primaryColor ?? null,
        secondaryColor: team.secondaryColor ?? null,
      },
    });
    return row.id;
  }

  // ---------------------------------------------------------------------
  // Matches
  // ---------------------------------------------------------------------

  async syncMatches(
    provider: ProviderName,
    role: FeedRole,
    matches: ProviderMatch[],
  ): Promise<SyncResult> {
    const result: SyncResult = { matchIds: new Map(), created: 0, updated: 0, changes: 0 };
    if (matches.length === 0) return result;
    const now = new Date();

    const teamIds = await this.resolveTeams(
      provider,
      matches.flatMap((m) => [
        { team: m.home, competitionSlug: m.competitionSlug },
        { team: m.away, competitionSlug: m.competitionSlug },
      ]),
    );

    // Which of our matches are these?
    const refs = await this.findRefs(
      provider,
      'MATCH',
      matches.map((m) => m.externalId),
    );
    for (const r of refs) result.matchIds.set(r.externalId, r.internalId);
    const unresolved = matches.filter((m) => !result.matchIds.has(m.externalId));
    const newRefs: Prisma.ExternalRefCreateManyInput[] = [];
    for (const group of chunk(unresolved, CHUNK)) {
      const candidates = await this.prisma.match.findMany({
        where: {
          OR: group.map((m) => ({
            homeTeamId: teamIds.get(m.home.externalId)!,
            awayTeamId: teamIds.get(m.away.externalId)!,
            kickoffAt: {
              gte: new Date(m.kickoffAt.getTime() - SAME_MATCH_WINDOW_MS),
              lte: new Date(m.kickoffAt.getTime() + SAME_MATCH_WINDOW_MS),
            },
          })),
        },
        select: { id: true, homeTeamId: true, awayTeamId: true, kickoffAt: true },
      });
      for (const m of group) {
        const home = teamIds.get(m.home.externalId);
        const away = teamIds.get(m.away.externalId);
        const found = candidates
          .filter((c) => c.homeTeamId === home && c.awayTeamId === away)
          .sort(
            (a, b) =>
              Math.abs(a.kickoffAt.getTime() - m.kickoffAt.getTime()) -
              Math.abs(b.kickoffAt.getTime() - m.kickoffAt.getTime()),
          )[0];
        if (found) {
          result.matchIds.set(m.externalId, found.id);
          newRefs.push({
            provider,
            entityType: 'MATCH',
            externalId: m.externalId,
            internalId: found.id,
          });
        }
      }
    }

    // Load what we have for the known ones.
    const existing = new Map<string, ExistingMatch>();
    for (const ids of chunk([...new Set(result.matchIds.values())], CHUNK)) {
      const rows = await this.prisma.match.findMany({
        where: { id: { in: ids } },
        include: { events: true },
      });
      for (const row of rows) existing.set(row.id, row);
    }

    // Brand-new matches.
    const toCreate = matches.filter((m) => !result.matchIds.has(m.externalId));
    if (toCreate.length) {
      const created = await this.createMatches(provider, toCreate, teamIds, newRefs, now);
      for (const [ext, id] of created) result.matchIds.set(ext, id);
      result.created = created.size;
    }
    if (newRefs.length)
      await this.prisma.externalRef.createMany({ data: newRefs, skipDuplicates: true });

    // Changes to existing matches.
    const changed: { id: string; seq: number; changes: MatchChange[] }[] = [];
    for (const m of matches) {
      const id = result.matchIds.get(m.externalId)!;
      const row = existing.get(id);
      if (!row) continue;
      const outcome = await this.updateMatch(row, m, role, now);
      if (outcome) {
        result.updated++;
        result.changes += outcome.changes.length;
        if (outcome.changes.length) changed.push({ id, ...outcome });
      }
    }

    await this.publish(changed);
    return result;
  }

  private async findRefs(
    provider: ProviderName,
    entityType: 'MATCH' | 'TEAM',
    externalIds: string[],
  ) {
    const out = [];
    for (const ids of chunk([...new Set(externalIds)], 500)) {
      out.push(
        ...(await this.prisma.externalRef.findMany({
          where: { provider, entityType, externalId: { in: ids } },
        })),
      );
    }
    return out;
  }

  private async createMatches(
    provider: ProviderName,
    matches: ProviderMatch[],
    teamIds: Map<string, string>,
    newRefs: Prisma.ExternalRefCreateManyInput[],
    now: Date,
  ): Promise<Map<string, string>> {
    const created = new Map<string, string>();
    const teamRows = await this.prisma.team.findMany({
      where: { id: { in: [...new Set(teamIds.values())] } },
      select: { id: true, slug: true },
    });
    const teamSlug = new Map(teamRows.map((t) => [t.id, t.slug]));
    const bases = matches.map((m) =>
      matchSlug(
        teamSlug.get(teamIds.get(m.home.externalId)!)!,
        teamSlug.get(teamIds.get(m.away.externalId)!)!,
        m.kickoffAt,
      ),
    );
    const takenRows = await this.prisma.match.findMany({
      where: { slug: { in: bases } },
      select: { slug: true },
    });
    const taken = new Set(takenRows.map((r) => r.slug));

    const rows: Prisma.MatchCreateManyInput[] = [];
    const events: Prisma.MatchEventCreateManyInput[] = [];
    for (const [i, m] of matches.entries()) {
      const id = randomUUID();
      const slug = uniqueSlug(bases[i]!, (s) => taken.has(s));
      taken.add(slug);
      const competitionId = await this.competitionId(m.competitionSlug);
      rows.push({
        id,
        slug,
        competitionId,
        seasonId: m.seasonYear ? await this.seasonId(competitionId, { year: m.seasonYear }) : null,
        homeTeamId: teamIds.get(m.home.externalId)!,
        awayTeamId: teamIds.get(m.away.externalId)!,
        venueId: await this.venueId(m.venue),
        ...this.matchFields(m),
        liveSyncedAt: isLive(m.status) || isEnded(m.status) ? now : null,
        finalizedAt: isEnded(m.status) ? now : null,
        seq: 0,
      });
      for (const e of m.events ?? [])
        events.push({ matchId: id, providerKey: e.key, ...eventFields(e) });
      newRefs.push({ provider, entityType: 'MATCH', externalId: m.externalId, internalId: id });
      created.set(m.externalId, id);
    }
    for (const part of chunk(rows, 500)) await this.prisma.match.createMany({ data: part });
    for (const part of chunk(events, 1000))
      await this.prisma.matchEvent.createMany({ data: part, skipDuplicates: true });
    return created;
  }

  private matchFields(m: ProviderMatch) {
    return {
      kickoffAt: m.kickoffAt,
      status: m.status,
      minute: m.minute ?? null,
      injuryTime: m.injuryTime ?? null,
      periodStartedAt: m.periodStartedAt ?? null,
      homeScore: m.score.home,
      awayScore: m.score.away,
      htHome: m.halfTime?.home ?? null,
      htAway: m.halfTime?.away ?? null,
      etHome: m.extraTime?.home ?? null,
      etAway: m.extraTime?.away ?? null,
      penHome: m.penalties?.home ?? null,
      penAway: m.penalties?.away ?? null,
      round: m.round ?? null,
      matchday: m.matchday ?? null,
      referee: m.referee ?? null,
      attendance: m.attendance ?? null,
    };
  }

  /**
   * Applies one provider's view of a match. Returns null when nothing
   * changed, otherwise the fan-visible changes (possibly none, e.g. only
   * the referee was filled in).
   */
  private async updateMatch(
    row: ExistingMatch,
    m: ProviderMatch,
    role: FeedRole,
    now: Date,
  ): Promise<{ seq: number; changes: MatchChange[] } | null> {
    const incoming = this.matchFields(m);
    const liveOwned =
      role === 'season' &&
      row.liveSyncedAt &&
      now.getTime() - row.liveSyncedAt.getTime() < LIVE_OWNERSHIP_MS;
    const wouldGoBackwards =
      role === 'season' &&
      ((isEnded(row.status as MatchStatus) && !isEnded(m.status)) ||
        (isLive(row.status as MatchStatus) && m.status === MatchStatus.Scheduled));
    const takeLiveFields = role === 'live' || (!liveOwned && !wouldGoBackwards);

    const next = { ...incoming };
    if (!takeLiveFields) {
      Object.assign(next, {
        status: row.status,
        minute: row.minute,
        injuryTime: row.injuryTime,
        periodStartedAt: row.periodStartedAt,
        homeScore: row.homeScore,
        awayScore: row.awayScore,
        htHome: row.htHome,
        htAway: row.htAway,
        etHome: row.etHome,
        etAway: row.etAway,
        penHome: row.penHome,
        penAway: row.penAway,
      });
    }
    // Never blank out details another feed provided.
    for (const key of ['referee', 'round', 'matchday', 'attendance', 'htHome', 'htAway'] as const) {
      if (next[key] === null && row[key] !== null)
        (next as Record<string, unknown>)[key] = row[key];
    }

    const prevEvents = row.events.map(toSnapshotEvent);
    const nextEvents =
      takeLiveFields && m.events
        ? m.events.map((e) => ({ key: e.key, ...eventFields(e) }))
        : undefined;
    const changes = diffMatch(snapshot(row), snapshot(next), prevEvents, nextEvents);

    const fieldPatch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(next)) {
      const old = (row as Record<string, unknown>)[key];
      const same =
        value instanceof Date && old instanceof Date
          ? value.getTime() === old.getTime()
          : value === old;
      if (!same) fieldPatch[key] = value;
    }
    const venueId = await this.venueId(m.venue);
    if (venueId && venueId !== row.venueId) fieldPatch.venueId = venueId;
    if (Object.keys(fieldPatch).length === 0 && changes.length === 0) {
      if (role === 'live')
        await this.prisma.match.update({ where: { id: row.id }, data: { liveSyncedAt: now } });
      return null;
    }

    const persisted = changes.filter(isPersistedChange);
    const seq = row.seq + persisted.length;
    const ended = isEnded(next.status as MatchStatus);
    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.match.update({
        where: { id: row.id },
        data: {
          ...fieldPatch,
          seq,
          ...(role === 'live' ? { liveSyncedAt: now } : {}),
          finalizedAt: ended ? (row.finalizedAt ?? now) : null,
        },
      }),
    ];
    if (nextEvents) {
      const keep = new Set(nextEvents.map((e) => e.key));
      const gone = row.events.filter((e) => !keep.has(e.providerKey)).map((e) => e.id);
      if (gone.length) ops.push(this.prisma.matchEvent.deleteMany({ where: { id: { in: gone } } }));
      for (const c of changes) {
        if (c.type !== 'event') continue;
        const { key, ...fields } = c.event;
        ops.push(
          this.prisma.matchEvent.upsert({
            where: { matchId_providerKey: { matchId: row.id, providerKey: key } },
            create: { matchId: row.id, providerKey: key, ...fields },
            update: fields,
          }),
        );
      }
    }
    if (persisted.length) {
      ops.push(
        this.prisma.matchUpdate.createMany({
          data: persisted.map((c, i) => ({
            matchId: row.id,
            seq: row.seq + i + 1,
            type: c.type,
            payload: c as unknown as Prisma.InputJsonValue,
          })),
        }),
      );
    }
    await this.prisma.$transaction(ops);
    return { seq, changes };
  }

  private async publish(
    changed: { id: string; seq: number; changes: MatchChange[] }[],
  ): Promise<void> {
    if (changed.length === 0) return;
    const rows = await this.prisma.match.findMany({
      where: { id: { in: changed.map((c) => c.id) } },
      include: matchSummaryInclude,
    });
    for (const row of rows) {
      const c = changed.find((x) => x.id === row.id)!;
      this.bus.publish({
        matchId: row.id,
        competitionSlug: row.competition.slug,
        isDemo: false,
        seq: c.seq,
        changes: c.changes,
        summary: toMatchSummary(row),
      });
    }
  }

  // ---------------------------------------------------------------------
  // Details, standings, scorers
  // ---------------------------------------------------------------------

  async saveDetails(
    provider: ProviderName,
    details: ProviderMatchDetails,
  ): Promise<string | undefined> {
    const { matchIds } = await this.syncMatches(provider, 'live', [details.match]);
    const matchId = matchIds.get(details.match.externalId);
    if (!matchId) return undefined;

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (details.lineups?.length) {
      ops.push(this.prisma.lineup.deleteMany({ where: { matchId } }));
      for (const l of details.lineups) {
        ops.push(
          this.prisma.lineup.create({
            data: {
              matchId,
              side: l.side,
              formation: l.formation ?? null,
              coachName: l.coachName ?? null,
              players: {
                create: l.players.map((p, order) => ({
                  name: p.name,
                  number: p.number ?? null,
                  position: p.position ?? null,
                  grid: p.grid ?? null,
                  isStarter: p.isStarter,
                  order,
                })),
              },
            },
          }),
        );
      }
    }
    for (const s of details.stats ?? []) {
      const data = { homeValue: s.home, awayValue: s.away, unit: s.unit ?? null };
      ops.push(
        this.prisma.matchStat.upsert({
          where: { matchId_type: { matchId, type: s.type } },
          create: { matchId, type: s.type, ...data },
          update: data,
        }),
      );
    }
    ops.push(
      this.prisma.match.update({ where: { id: matchId }, data: { detailsSyncedAt: new Date() } }),
    );
    await this.prisma.$transaction(ops);
    return matchId;
  }

  async saveStandings(provider: ProviderName, standings: ProviderStandings): Promise<number> {
    const competitionId = await this.competitionId(standings.competitionSlug);
    if (standings.emblemUrl) {
      await this.prisma.competition.update({
        where: { id: competitionId },
        data: { emblemUrl: standings.emblemUrl },
      });
    }
    const seasonId = await this.seasonId(competitionId, standings.season, true);
    const teamIds = await this.resolveTeams(
      provider,
      standings.rows.map((r) => ({ team: r.team, competitionSlug: standings.competitionSlug })),
    );
    await this.prisma.$transaction([
      this.prisma.standing.deleteMany({ where: { seasonId } }),
      this.prisma.standing.createMany({
        data: standings.rows.map((r) => ({
          seasonId,
          teamId: teamIds.get(r.team.externalId)!,
          group: r.group,
          position: r.position,
          played: r.played,
          won: r.won,
          drawn: r.drawn,
          lost: r.lost,
          goalsFor: r.goalsFor,
          goalsAgainst: r.goalsAgainst,
          goalDiff: r.goalDiff,
          points: r.points,
          form: r.form ?? null,
        })),
        skipDuplicates: true,
      }),
    ]);
    return standings.rows.length;
  }

  async saveScorers(
    provider: ProviderName,
    competitionSlug: string,
    data: { season: ProviderSeason; scorers: ProviderScorer[] },
  ): Promise<number> {
    const competitionId = await this.competitionId(competitionSlug);
    const seasonId = await this.seasonId(competitionId, data.season, true);
    const teamIds = await this.resolveTeams(
      provider,
      data.scorers.map((s) => ({ team: s.team, competitionSlug })),
    );
    let rank = 0;
    let lastGoals = Number.POSITIVE_INFINITY;
    const rows = data.scorers.map((s, i) => {
      if (s.goals < lastGoals) rank = i + 1;
      lastGoals = s.goals;
      return {
        seasonId,
        teamId: teamIds.get(s.team.externalId)!,
        playerName: s.playerName,
        rank,
        goals: s.goals,
        assists: s.assists ?? null,
        penalties: s.penalties ?? null,
        played: s.played ?? null,
      };
    });
    await this.prisma.$transaction([
      this.prisma.topScorer.deleteMany({ where: { seasonId } }),
      this.prisma.topScorer.createMany({ data: rows, skipDuplicates: true }),
    ]);
    return rows.length;
  }
}

function snapshot(m: {
  status: string;
  kickoffAt: Date;
  minute: number | null;
  injuryTime: number | null;
  homeScore: number | null;
  awayScore: number | null;
  htHome: number | null;
  htAway: number | null;
  penHome: number | null;
  penAway: number | null;
}): MatchSnapshot {
  return {
    status: m.status as MatchStatus,
    kickoffAt: m.kickoffAt,
    minute: m.minute,
    injuryTime: m.injuryTime,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    htHome: m.htHome,
    htAway: m.htAway,
    penHome: m.penHome,
    penAway: m.penAway,
  };
}

function eventFields(e: {
  type: string;
  side: string;
  minute: number;
  extraMinute?: number | null;
  playerName?: string | null;
  assistName?: string | null;
  detail?: string | null;
}) {
  return {
    type: e.type as SnapshotEvent['type'],
    side: e.side as SnapshotEvent['side'],
    minute: e.minute,
    extraMinute: e.extraMinute ?? null,
    playerName: e.playerName ?? null,
    assistName: e.assistName ?? null,
    detail: e.detail ?? null,
  };
}

function toSnapshotEvent(e: ExistingMatch['events'][number]): SnapshotEvent {
  return { key: e.providerKey, ...eventFields(e) };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
