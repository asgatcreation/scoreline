import type { EventType, MatchStatus, Side } from '@scoreline/shared';

/**
 * Normalised data every provider adapter produces. Nothing outside an
 * adapter ever sees a provider's raw JSON.
 */

export type ProviderName = 'DEMO' | 'API_FOOTBALL' | 'FOOTBALL_DATA';

export interface ProviderTeam {
  externalId: string;
  name: string;
  shortName?: string | null;
  tla?: string | null;
  crestUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  country?: string | null;
  isNational?: boolean;
}

export interface ProviderScore {
  home: number | null;
  away: number | null;
}

export interface ProviderEvent {
  /** Stable within a match so re-ingesting never duplicates events. */
  key: string;
  type: EventType;
  side: Side;
  minute: number;
  extraMinute?: number | null;
  playerName?: string | null;
  assistName?: string | null;
  detail?: string | null;
}

export interface ProviderMatch {
  externalId: string;
  /** Our competition slug (adapters drop competitions we don't track). */
  competitionSlug: string;
  seasonYear?: number | null;
  home: ProviderTeam;
  away: ProviderTeam;
  kickoffAt: Date;
  status: MatchStatus;
  minute?: number | null;
  injuryTime?: number | null;
  periodStartedAt?: Date | null;
  score: ProviderScore;
  halfTime?: ProviderScore | null;
  extraTime?: ProviderScore | null;
  penalties?: ProviderScore | null;
  round?: string | null;
  matchday?: number | null;
  venue?: { name: string; city?: string | null } | null;
  referee?: string | null;
  attendance?: number | null;
  /** undefined = this feed doesn't carry events; [] = no events yet. */
  events?: ProviderEvent[];
  isDemo?: boolean;
}

export interface ProviderLineupPlayer {
  name: string;
  number?: number | null;
  position?: string | null;
  grid?: string | null;
  isStarter: boolean;
}

export interface ProviderLineup {
  side: Side;
  formation?: string | null;
  coachName?: string | null;
  players: ProviderLineupPlayer[];
}

export interface ProviderStat {
  type: string;
  home: number | null;
  away: number | null;
  unit?: string | null;
}

export interface ProviderMatchDetails {
  match: ProviderMatch;
  lineups?: ProviderLineup[];
  stats?: ProviderStat[];
}

export interface ProviderSeason {
  year: number;
  startDate?: string | null;
  endDate?: string | null;
  currentMatchday?: number | null;
}

export interface ProviderStandingRow {
  team: ProviderTeam;
  group: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  form?: string | null;
}

export interface ProviderStandings {
  competitionSlug: string;
  emblemUrl?: string | null;
  season: ProviderSeason;
  rows: ProviderStandingRow[];
}

export interface ProviderScorer {
  playerName: string;
  team: ProviderTeam;
  goals: number;
  assists?: number | null;
  penalties?: number | null;
  played?: number | null;
}

/**
 * Fast feed: what is live now and what is on around today. API-Football
 * fills this role; football-data.org can stand in (delayed scores).
 */
export interface LiveSource {
  readonly name: ProviderName;
  getLive(): Promise<ProviderMatch[]>;
  getByDate(date: string): Promise<ProviderMatch[]>;
  getDetails(externalId: string): Promise<ProviderMatchDetails | null>;
}

/**
 * Season feed: fixtures, results, tables and scorers for whole seasons.
 * football-data.org fills this role on the free plans.
 */
export interface SeasonSource {
  readonly name: ProviderName;
  /** Competition slugs this source can serve. */
  competitions(): string[];
  getMatches(competitionSlug: string, from: string, to: string): Promise<ProviderMatch[]>;
  getStandings(competitionSlug: string): Promise<ProviderStandings | null>;
  getScorers(
    competitionSlug: string,
  ): Promise<{ season: ProviderSeason; scorers: ProviderScorer[] } | null>;
}
