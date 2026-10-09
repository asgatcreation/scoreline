import { EventType, MatchStatus, Side, isGoalEvent } from '@scoreline/shared';
import type { TrackedCompetition } from '../../football/competitions.js';
import type {
  ProviderEvent,
  ProviderLineup,
  ProviderMatch,
  ProviderMatchDetails,
  ProviderStat,
  ProviderTeam,
} from '../types.js';

// Raw API-Football v3 shapes (only the fields we read).

interface AfTeam {
  id: number;
  name: string;
  logo?: string | null;
}

interface AfEvent {
  time: { elapsed: number; extra: number | null };
  team: { id: number };
  player: { id: number | null; name: string | null };
  assist: { id: number | null; name: string | null };
  type: string;
  detail: string;
  comments?: string | null;
}

interface AfLineup {
  team: { id: number };
  formation: string | null;
  coach: { name: string | null } | null;
  startXI: { player: AfLineupPlayer }[];
  substitutes: { player: AfLineupPlayer }[];
}

interface AfLineupPlayer {
  name: string;
  number: number | null;
  pos: string | null;
  grid: string | null;
}

export interface AfFixture {
  fixture: {
    id: number;
    referee: string | null;
    date: string;
    periods: { first: number | null; second: number | null };
    venue: { id: number | null; name: string | null; city: string | null };
    status: { short: string; elapsed: number | null; extra?: number | null };
  };
  league: { id: number; season: number; round: string | null };
  teams: { home: AfTeam; away: AfTeam };
  goals: { home: number | null; away: number | null };
  score: {
    halftime: { home: number | null; away: number | null };
    extratime: { home: number | null; away: number | null };
    penalty: { home: number | null; away: number | null };
  };
  events?: AfEvent[];
  lineups?: AfLineup[];
  statistics?: {
    team: { id: number };
    statistics: { type: string; value: number | string | null }[];
  }[];
}

const STATUS: Record<string, MatchStatus> = {
  TBD: MatchStatus.Scheduled,
  NS: MatchStatus.Scheduled,
  '1H': MatchStatus.FirstHalf,
  HT: MatchStatus.HalfTime,
  '2H': MatchStatus.SecondHalf,
  ET: MatchStatus.ExtraTime,
  BT: MatchStatus.BreakExtraTime,
  P: MatchStatus.Penalties,
  SUSP: MatchStatus.Suspended,
  INT: MatchStatus.Suspended,
  FT: MatchStatus.Finished,
  AET: MatchStatus.Finished,
  PEN: MatchStatus.Finished,
  AWD: MatchStatus.Finished,
  WO: MatchStatus.Finished,
  PST: MatchStatus.Postponed,
  CANC: MatchStatus.Cancelled,
  ABD: MatchStatus.Abandoned,
};

export function mapStatus(short: string, elapsed: number | null): MatchStatus {
  if (short === 'LIVE') {
    return (elapsed ?? 0) > 45 ? MatchStatus.SecondHalf : MatchStatus.FirstHalf;
  }
  return STATUS[short] ?? MatchStatus.Scheduled;
}

/** Competitions made of national teams rather than clubs. */
const NATIONAL_TEAM_COMPETITIONS = new Set([
  'africa-cup-of-nations',
  'world-cup-qualifiers-africa',
  'world-cup',
  'nations-league',
  'world-cup-qualifiers-europe',
  'european-championship',
  'international-friendlies',
]);

function mapTeam(team: AfTeam, competition: TrackedCompetition): ProviderTeam {
  return {
    externalId: String(team.id),
    name: team.name,
    crestUrl: team.logo ?? null,
    isNational: NATIONAL_TEAM_COMPETITIONS.has(competition.slug),
  };
}

function periodStart(f: AfFixture, status: MatchStatus): Date | null {
  const unix =
    status === MatchStatus.FirstHalf
      ? f.fixture.periods.first
      : status === MatchStatus.SecondHalf
        ? f.fixture.periods.second
        : null;
  return unix ? new Date(unix * 1000) : null;
}

function matchdayFromRound(round: string | null): number | null {
  const m = round?.match(/^Regular Season - (\d+)$/);
  return m ? Number(m[1]) : null;
}

function scoreOrNull(s: { home: number | null; away: number | null }) {
  return s.home === null && s.away === null ? null : { home: s.home, away: s.away };
}

export function mapFixture(f: AfFixture, competition: TrackedCompetition): ProviderMatch {
  const status = mapStatus(f.fixture.status.short, f.fixture.status.elapsed);
  const live = status !== MatchStatus.Scheduled && f.fixture.status.elapsed !== null;
  const match: ProviderMatch = {
    externalId: String(f.fixture.id),
    competitionSlug: competition.slug,
    seasonYear: f.league.season,
    home: mapTeam(f.teams.home, competition),
    away: mapTeam(f.teams.away, competition),
    kickoffAt: new Date(f.fixture.date),
    status,
    minute: live ? f.fixture.status.elapsed : null,
    injuryTime: live ? (f.fixture.status.extra ?? null) : null,
    periodStartedAt: periodStart(f, status),
    score: { home: f.goals.home, away: f.goals.away },
    halfTime: scoreOrNull(f.score.halftime),
    extraTime: scoreOrNull(f.score.extratime),
    penalties: scoreOrNull(f.score.penalty),
    round: f.league.round,
    matchday: matchdayFromRound(f.league.round),
    venue: f.fixture.venue.name ? { name: f.fixture.venue.name, city: f.fixture.venue.city } : null,
    referee: f.fixture.referee,
  };
  if (f.events) match.events = mapEvents(f.events, f.teams.home.id, match.score);
  return match;
}

function mapEventType(e: AfEvent): EventType | null {
  const detail = e.detail.toLowerCase();
  switch (e.type.toLowerCase()) {
    case 'goal':
      if (detail.includes('own')) return EventType.OwnGoal;
      if (detail.includes('missed')) return EventType.MissedPenalty;
      if (detail.includes('penalty')) return EventType.PenaltyGoal;
      return EventType.Goal;
    case 'card':
      if (detail.includes('second')) return EventType.SecondYellow;
      if (detail.includes('red')) return EventType.RedCard;
      return EventType.YellowCard;
    case 'subst':
      return EventType.Substitution;
    case 'var':
      return EventType.Var;
    default:
      return null;
  }
}

/**
 * API-Football conventions (checked against real data):
 * - substitution: `player` goes OFF, `assist` comes ON. We store the player
 *   coming on as playerName and the one going off as assistName.
 * - own goal: `team` is the scorer's own team. We record goals on the side
 *   that benefits, verified against the final score when possible.
 */
export function mapEvents(
  events: AfEvent[],
  homeTeamId: number,
  finalScore?: { home: number | null; away: number | null },
): ProviderEvent[] {
  const seen = new Map<string, number>();
  const mapped: ProviderEvent[] = [];

  for (const e of events) {
    const type = mapEventType(e);
    if (!type) continue;
    const teamSide = e.team.id === homeTeamId ? Side.Home : Side.Away;
    const isSub = type === EventType.Substitution;
    const base = [
      type,
      e.time.elapsed,
      e.time.extra ?? 0,
      e.team.id,
      e.player.id ?? e.player.name ?? '?',
    ].join('|');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    mapped.push({
      key: n === 0 ? base : `${base}#${n}`,
      type,
      side: teamSide,
      minute: e.time.elapsed,
      extraMinute: e.time.extra,
      playerName: isSub ? e.assist.name : e.player.name,
      assistName: isSub ? e.player.name : e.assist.name,
      detail:
        type === EventType.Var || type === EventType.MissedPenalty
          ? e.detail
          : (e.comments ?? null),
    });
  }

  flipOwnGoalsToBeneficiary(mapped, finalScore);
  return mapped;
}

function flipOwnGoalsToBeneficiary(
  events: ProviderEvent[],
  finalScore?: { home: number | null; away: number | null },
): void {
  const ownGoals = events.filter((e) => e.type === EventType.OwnGoal);
  if (ownGoals.length === 0) return;
  const tally = (flip: boolean) => {
    let home = 0;
    let away = 0;
    for (const e of events) {
      if (!isGoalEvent(e.type)) continue;
      const side = e.type === EventType.OwnGoal && flip ? other(e.side) : e.side;
      if (side === Side.Home) home++;
      else away++;
    }
    return { home, away };
  };
  const matches = (t: { home: number; away: number }) =>
    finalScore?.home === t.home && finalScore?.away === t.away;
  // Default to flipping (the documented convention); keep the raw side only
  // when that is the version that adds up to the real score.
  const keepRaw = finalScore && matches(tally(false)) && !matches(tally(true));
  if (!keepRaw) for (const e of ownGoals) e.side = other(e.side);
}

function other(side: Side): Side {
  return side === Side.Home ? Side.Away : Side.Home;
}

const STAT_KEYS: Record<string, { type: string; unit?: string }> = {
  'Ball Possession': { type: 'possession', unit: '%' },
  'Total Shots': { type: 'shots' },
  'Shots on Goal': { type: 'shots_on_target' },
  'Shots off Goal': { type: 'shots_off_target' },
  'Blocked Shots': { type: 'blocked_shots' },
  'Corner Kicks': { type: 'corners' },
  Fouls: { type: 'fouls' },
  Offsides: { type: 'offsides' },
  'Yellow Cards': { type: 'yellow_cards' },
  'Red Cards': { type: 'red_cards' },
  'Goalkeeper Saves': { type: 'saves' },
  'Total passes': { type: 'passes' },
  'Passes %': { type: 'pass_accuracy', unit: '%' },
  expected_goals: { type: 'xg' },
};

function statValue(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === 'number' ? v : Number.parseFloat(v.replace('%', ''));
  return Number.isFinite(n) ? n : null;
}

export function mapStats(f: AfFixture): ProviderStat[] {
  const [home, away] = [f.teams.home.id, f.teams.away.id].map((id) =>
    f.statistics?.find((s) => s.team.id === id),
  );
  if (!home || !away) return [];
  const out: ProviderStat[] = [];
  for (const [raw, meta] of Object.entries(STAT_KEYS)) {
    const h = home.statistics.find((s) => s.type === raw);
    const a = away.statistics.find((s) => s.type === raw);
    if (!h && !a) continue;
    out.push({
      type: meta.type,
      home: statValue(h?.value ?? null) ?? 0,
      away: statValue(a?.value ?? null) ?? 0,
      unit: meta.unit ?? null,
    });
  }
  return out;
}

export function mapLineups(f: AfFixture): ProviderLineup[] {
  return (f.lineups ?? []).map((l) => ({
    side: l.team.id === f.teams.home.id ? Side.Home : Side.Away,
    formation: l.formation,
    coachName: l.coach?.name ?? null,
    players: [
      ...l.startXI.map(({ player }) => ({ ...lineupPlayer(player), isStarter: true })),
      ...l.substitutes.map(({ player }) => ({ ...lineupPlayer(player), isStarter: false })),
    ],
  }));
}

function lineupPlayer(p: AfLineupPlayer) {
  return { name: p.name, number: p.number, position: p.pos, grid: p.grid };
}

export function mapDetails(f: AfFixture, competition: TrackedCompetition): ProviderMatchDetails {
  return { match: mapFixture(f, competition), lineups: mapLineups(f), stats: mapStats(f) };
}
