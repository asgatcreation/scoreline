import type { EventType, Side } from './events.js';
import type { MatchStatus } from './match-status.js';

// Shapes returned by the Scoreline REST API. Dates are ISO strings.

export interface CompetitionRef {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  country: string | null;
  emblemUrl: string | null;
  isDemo: boolean;
}

export interface TeamRef {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  tla: string | null;
  crestUrl: string | null;
  primaryColor: string | null;
}

export interface Score {
  home: number | null;
  away: number | null;
}

export interface MatchSummary {
  id: string;
  slug: string;
  competition: CompetitionRef;
  kickoffAt: string;
  status: MatchStatus;
  minute: number | null;
  injuryTime: number | null;
  /** When the current half started, so clients can tick the clock. */
  periodStartedAt: string | null;
  home: TeamRef;
  away: TeamRef;
  score: Score;
  halfTime: Score;
  penalties: Score | null;
  round: string | null;
  isDemo: boolean;
  /** Increases with every change; used to resume live updates. */
  seq: number;
}

export interface MatchEventDto {
  id: string;
  type: EventType;
  side: Side;
  minute: number;
  extraMinute: number | null;
  playerName: string | null;
  assistName: string | null;
  detail: string | null;
}

export interface LineupPlayerDto {
  name: string;
  number: number | null;
  position: string | null;
  grid: string | null;
  isStarter: boolean;
}

export interface LineupDto {
  side: Side;
  formation: string | null;
  coachName: string | null;
  players: LineupPlayerDto[];
}

export interface MatchStatDto {
  type: string;
  home: number | null;
  away: number | null;
  unit: string | null;
}

export interface MatchDetail extends MatchSummary {
  venue: { name: string; city: string | null } | null;
  referee: string | null;
  attendance: number | null;
  events: MatchEventDto[];
  lineups: LineupDto[];
  stats: MatchStatDto[];
  headToHead: MatchSummary[];
}

export interface CompetitionGroup {
  competition: CompetitionRef;
  matches: MatchSummary[];
}

export interface MatchesByDayResponse {
  date: string;
  timezone: string;
  groups: CompetitionGroup[];
}

export interface StandingRow {
  position: number;
  team: TeamRef;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  form: string | null;
  zone: string | null;
}

export interface StandingsTable {
  group: string;
  rows: StandingRow[];
}

export interface TopScorerRow {
  rank: number;
  playerName: string;
  team: TeamRef;
  goals: number;
  assists: number | null;
  penalties: number | null;
  played: number | null;
}

export interface CompetitionDetail extends CompetitionRef {
  type: 'LEAGUE' | 'CUP';
  season: { year: number; currentMatchday: number | null } | null;
}

export interface TeamDetail extends TeamRef {
  country: string | null;
  founded: number | null;
  isNational: boolean;
  venue: { name: string; city: string | null } | null;
  competitions: CompetitionRef[];
  /** Most recent last. */
  form: ('W' | 'D' | 'L')[];
  recent: MatchSummary[];
  upcoming: MatchSummary[];
  squad: { name: string; position: string | null; shirtNumber: number | null }[];
}

export interface SearchResult {
  teams: TeamRef[];
  competitions: CompetitionRef[];
}
