import type { EventType, Side } from './events.js';
import type { MatchStatus } from './match-status.js';
import type { MatchSummary } from './api-types.js';

/**
 * Socket.IO protocol between the API and browsers. Rooms:
 *   "live"                 every update for a match that is (or just was) live
 *   "match:<matchId>"      one match (the match page)
 *   "competition:<slug>"   every match in one competition
 */
export type RoomName = 'live' | `match:${string}` | `competition:${string}`;

const ROOM_RE = /^(live|match:[a-z0-9-]{1,120}|competition:[a-z0-9-]{1,120})$/;

export function isRoomName(value: unknown): value is RoomName {
  return typeof value === 'string' && ROOM_RE.test(value);
}

export const MAX_ROOMS_PER_CLIENT = 40;

export interface DeltaEvent {
  key: string;
  type: EventType;
  side: Side;
  minute: number;
  extraMinute: number | null;
  playerName: string | null;
  assistName: string | null;
  detail: string | null;
}

/** One small change; mirrors the API's MatchChange. */
export type MatchDelta =
  | { type: 'status'; status: MatchStatus; previous: MatchStatus }
  | { type: 'score'; home: number | null; away: number | null }
  | { type: 'halftime'; home: number | null; away: number | null }
  | { type: 'penalties'; home: number | null; away: number | null }
  | { type: 'kickoff'; kickoffAt: string }
  | { type: 'minute'; minute: number | null; injuryTime: number | null }
  | { type: 'event'; event: DeltaEvent }
  | { type: 'event-removed'; key: string };

export interface MatchUpdateMessage {
  matchId: string;
  seq: number;
  changes: MatchDelta[];
  /** The match as it is now, so lists can redraw the row directly. */
  summary: MatchSummary;
}

/** Sent instead of deltas when a client was behind (e.g. after a reconnect). */
export interface MatchSyncMessage {
  matchId: string;
  summary: MatchSummary;
}

export interface ViewersMessage {
  matchId: string;
  count: number;
}

export interface HelloMessage {
  /** Server clock, so clients can tick the match minute accurately. */
  serverTime: string;
}

export interface SubscribeRequest {
  rooms: string[];
  /** Last seq seen per match id; the server re-syncs anything newer. */
  seqs?: Record<string, number>;
}

export interface SubscribeAck {
  ok: boolean;
  joined: RoomName[];
  rejected: string[];
  error?: string;
}

export interface ServerToClientEvents {
  hello: (msg: HelloMessage) => void;
  'match:update': (msg: MatchUpdateMessage) => void;
  'match:sync': (msg: MatchSyncMessage) => void;
  viewers: (msg: ViewersMessage) => void;
}

export interface ClientToServerEvents {
  subscribe: (req: SubscribeRequest, ack: (res: SubscribeAck) => void) => void;
  unsubscribe: (req: { rooms: string[] }, ack?: (res: { ok: boolean }) => void) => void;
}

/** Applies deltas to a summary; lets clients stay correct between full loads. */
export function applyDeltas(summary: MatchSummary, changes: MatchDelta[]): MatchSummary {
  const next: MatchSummary = {
    ...summary,
    score: { ...summary.score },
    halfTime: { ...summary.halfTime },
  };
  for (const c of changes) {
    switch (c.type) {
      case 'status':
        next.status = c.status;
        break;
      case 'score':
        next.score = { home: c.home, away: c.away };
        break;
      case 'halftime':
        next.halfTime = { home: c.home, away: c.away };
        break;
      case 'penalties':
        next.penalties = { home: c.home, away: c.away };
        break;
      case 'kickoff':
        next.kickoffAt = c.kickoffAt;
        break;
      case 'minute':
        next.minute = c.minute;
        next.injuryTime = c.injuryTime;
        break;
      default:
        break;
    }
  }
  return next;
}

/** True when a change is a goal being scored (for the goal animation and sound). */
export function isGoalDelta(change: MatchDelta): boolean {
  return (
    change.type === 'event' &&
    (change.event.type === 'GOAL' ||
      change.event.type === 'OWN_GOAL' ||
      change.event.type === 'PENALTY_GOAL')
  );
}
