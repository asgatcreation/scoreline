import type {
  CompetitionRef,
  MatchEventDto,
  MatchStatus,
  MatchSummary,
  TeamRef,
} from '@scoreline/shared';
import type { Prisma } from '../generated/prisma/client.js';

/** Prisma include that loads everything a MatchSummary needs. */
export const matchSummaryInclude = {
  competition: true,
  homeTeam: true,
  awayTeam: true,
} satisfies Prisma.MatchInclude;

export type MatchWithRefs = Prisma.MatchGetPayload<{ include: typeof matchSummaryInclude }>;

type CompetitionRow = MatchWithRefs['competition'];
type TeamRow = MatchWithRefs['homeTeam'];

export function toCompetitionRef(c: CompetitionRow): CompetitionRef {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    shortName: c.shortName,
    country: c.country,
    emblemUrl: c.emblemUrl,
    isDemo: c.isDemo,
  };
}

export function toTeamRef(t: TeamRow): TeamRef {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    shortName: t.shortName,
    tla: t.tla,
    crestUrl: t.crestUrl,
    primaryColor: t.primaryColor,
  };
}

export function toMatchSummary(m: MatchWithRefs): MatchSummary {
  return {
    id: m.id,
    slug: m.slug,
    competition: toCompetitionRef(m.competition),
    kickoffAt: m.kickoffAt.toISOString(),
    status: m.status as MatchStatus,
    minute: m.minute,
    injuryTime: m.injuryTime,
    periodStartedAt: m.periodStartedAt?.toISOString() ?? null,
    home: toTeamRef(m.homeTeam),
    away: toTeamRef(m.awayTeam),
    score: { home: m.homeScore, away: m.awayScore },
    halfTime: { home: m.htHome, away: m.htAway },
    penalties:
      m.penHome === null && m.penAway === null ? null : { home: m.penHome, away: m.penAway },
    round: m.round,
    isDemo: m.isDemo,
    seq: m.seq,
  };
}

export function toEventDto(e: {
  id: string;
  type: string;
  side: string;
  minute: number;
  extraMinute: number | null;
  playerName: string | null;
  assistName: string | null;
  detail: string | null;
}): MatchEventDto {
  return {
    id: e.id,
    type: e.type as MatchEventDto['type'],
    side: e.side as MatchEventDto['side'],
    minute: e.minute,
    extraMinute: e.extraMinute,
    playerName: e.playerName,
    assistName: e.assistName,
    detail: e.detail,
  };
}
