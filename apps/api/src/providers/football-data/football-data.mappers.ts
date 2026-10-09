import { MatchStatus } from '@scoreline/shared';
import type { TrackedCompetition } from '../../football/competitions.js';
import type {
  ProviderMatch,
  ProviderScorer,
  ProviderSeason,
  ProviderStandings,
  ProviderTeam,
} from '../types.js';

// Raw football-data.org v4 shapes (only the fields we read).

export interface FdTeam {
  id: number;
  name: string;
  shortName?: string | null;
  tla?: string | null;
  crest?: string | null;
}

interface FdScorePair {
  home: number | null;
  away: number | null;
}

export interface FdSeason {
  startDate: string;
  endDate: string;
  currentMatchday: number | null;
}

export interface FdMatch {
  id: number;
  utcDate: string;
  status: string;
  minute?: number | string | null;
  injuryTime?: number | null;
  matchday: number | null;
  stage: string | null;
  group: string | null;
  season?: FdSeason;
  competition: { code: string };
  homeTeam: FdTeam;
  awayTeam: FdTeam;
  score: {
    duration: string;
    fullTime: FdScorePair;
    halfTime: FdScorePair;
    regularTime?: FdScorePair;
    extraTime?: FdScorePair;
    penalties?: FdScorePair;
  };
  venue?: string | null;
  referees?: { name: string; type?: string }[];
  attendance?: number | null;
}

export interface FdStandingsResponse {
  competition: { code: string; emblem?: string | null };
  season: FdSeason;
  standings: {
    stage: string;
    type: string;
    group: string | null;
    table: {
      position: number;
      team: FdTeam;
      playedGames: number;
      won: number;
      draw: number;
      lost: number;
      points: number;
      goalsFor: number;
      goalsAgainst: number;
      goalDifference: number;
    }[];
  }[];
}

export interface FdScorersResponse {
  season: FdSeason;
  scorers: {
    player: { name: string };
    team: FdTeam;
    playedMatches?: number | null;
    goals: number;
    assists: number | null;
    penalties: number | null;
  }[];
}

const STATUS: Record<string, MatchStatus> = {
  SCHEDULED: MatchStatus.Scheduled,
  TIMED: MatchStatus.Scheduled,
  PAUSED: MatchStatus.HalfTime,
  EXTRA_TIME: MatchStatus.ExtraTime,
  PENALTY_SHOOTOUT: MatchStatus.Penalties,
  FINISHED: MatchStatus.Finished,
  AWARDED: MatchStatus.Finished,
  SUSPENDED: MatchStatus.Suspended,
  POSTPONED: MatchStatus.Postponed,
  CANCELLED: MatchStatus.Cancelled,
};

/**
 * football-data.org does not say which half is being played, so an
 * in-play match counts as second half once an hour has passed.
 */
export function mapStatus(status: string, kickoffAt: Date, now: Date = new Date()): MatchStatus {
  if (status === 'IN_PLAY' || status === 'LIVE') {
    return now.getTime() - kickoffAt.getTime() > 60 * 60_000
      ? MatchStatus.SecondHalf
      : MatchStatus.FirstHalf;
  }
  return STATUS[status] ?? MatchStatus.Scheduled;
}

export function seasonYear(season: FdSeason): number {
  return Number(season.startDate.slice(0, 4));
}

function mapSeason(season: FdSeason): ProviderSeason {
  return {
    year: seasonYear(season),
    startDate: season.startDate,
    endDate: season.endDate,
    currentMatchday: season.currentMatchday,
  };
}

export function mapTeam(team: FdTeam, competition?: TrackedCompetition): ProviderTeam {
  return {
    externalId: String(team.id),
    name: team.name,
    shortName: team.shortName ?? null,
    tla: team.tla ?? null,
    crestUrl: team.crest ?? null,
    isNational: competition
      ? ['world-cup', 'european-championship'].includes(competition.slug)
      : false,
  };
}

function prettyStage(m: FdMatch): string | null {
  if (m.stage === 'REGULAR_SEASON' && m.matchday) return `Matchday ${m.matchday}`;
  const words = (m.group ?? m.stage)?.toLowerCase().replace(/_/g, ' ');
  return words ? words.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}

function sum(a?: FdScorePair, b?: FdScorePair): FdScorePair | null {
  if (!a) return null;
  return {
    home: a.home === null ? null : a.home + (b?.home ?? 0),
    away: a.away === null ? null : a.away + (b?.away ?? 0),
  };
}

export function mapMatch(
  m: FdMatch,
  competition: TrackedCompetition,
  now = new Date(),
): ProviderMatch {
  const kickoffAt = new Date(m.utcDate);
  const status = mapStatus(m.status, kickoffAt, now);
  // With a shoot-out, fullTime includes the penalties; the real score is
  // regular time plus extra time.
  const shootout = m.score.duration === 'PENALTY_SHOOTOUT' && m.score.regularTime;
  const score = shootout ? sum(m.score.regularTime, m.score.extraTime)! : m.score.fullTime;
  const minute =
    typeof m.minute === 'number' ? m.minute : Number.parseInt(String(m.minute ?? ''), 10);
  const referee = m.referees?.find((r) => !r.type || r.type === 'REFEREE')?.name ?? null;

  return {
    externalId: String(m.id),
    competitionSlug: competition.slug,
    seasonYear: m.season ? seasonYear(m.season) : null,
    home: mapTeam(m.homeTeam, competition),
    away: mapTeam(m.awayTeam, competition),
    kickoffAt,
    status,
    minute: Number.isFinite(minute) ? minute : null,
    injuryTime: m.injuryTime ?? null,
    score: { home: score.home, away: score.away },
    halfTime: m.score.halfTime.home === null ? null : m.score.halfTime,
    extraTime: m.score.extraTime ?? null,
    penalties: shootout ? (m.score.penalties ?? null) : null,
    round: prettyStage(m),
    matchday: m.matchday,
    venue: m.venue ? { name: m.venue } : null,
    referee,
    attendance: m.attendance ?? null,
  };
}

export function mapStandings(
  body: FdStandingsResponse,
  competition: TrackedCompetition,
): ProviderStandings {
  const rows = body.standings
    .filter((s) => s.type === 'TOTAL')
    .flatMap((s) => {
      // Leagues come back with group "Matchday" or null; real groups are "GROUP_A".
      const group = s.group?.startsWith('GROUP_') ? `Group ${s.group.slice(6)}` : '';
      return s.table.map((r) => ({
        team: mapTeam(r.team, competition),
        group,
        position: r.position,
        played: r.playedGames,
        won: r.won,
        drawn: r.draw,
        lost: r.lost,
        goalsFor: r.goalsFor,
        goalsAgainst: r.goalsAgainst,
        goalDiff: r.goalDifference,
        points: r.points,
      }));
    });
  return {
    competitionSlug: competition.slug,
    emblemUrl: body.competition.emblem ?? null,
    season: mapSeason(body.season),
    rows,
  };
}

export function mapScorers(
  body: FdScorersResponse,
  competition: TrackedCompetition,
): { season: ProviderSeason; scorers: ProviderScorer[] } {
  return {
    season: mapSeason(body.season),
    scorers: body.scorers.map((s) => ({
      playerName: s.player.name,
      team: mapTeam(s.team, competition),
      goals: s.goals,
      assists: s.assists,
      penalties: s.penalties,
      played: s.playedMatches ?? null,
    })),
  };
}
