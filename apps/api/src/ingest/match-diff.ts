import type { EventType, MatchStatus, Side } from '@scoreline/shared';

/** The parts of a match that fans see change during a game. */
export interface MatchSnapshot {
  status: MatchStatus;
  kickoffAt: Date;
  minute: number | null;
  injuryTime: number | null;
  homeScore: number | null;
  awayScore: number | null;
  htHome: number | null;
  htAway: number | null;
  penHome: number | null;
  penAway: number | null;
}

export interface SnapshotEvent {
  key: string;
  type: EventType;
  side: Side;
  minute: number;
  extraMinute: number | null;
  playerName: string | null;
  assistName: string | null;
  detail: string | null;
}

/**
 * Small deltas sent to browsers. "minute" changes are frequent and cheap,
 * so they are broadcast but not stored in the MatchUpdate log.
 */
export type MatchChange =
  | { type: 'status'; status: MatchStatus; previous: MatchStatus }
  | { type: 'score'; home: number | null; away: number | null }
  | { type: 'halftime'; home: number | null; away: number | null }
  | { type: 'penalties'; home: number | null; away: number | null }
  | { type: 'kickoff'; kickoffAt: string }
  | { type: 'minute'; minute: number | null; injuryTime: number | null }
  | { type: 'event'; event: SnapshotEvent }
  | { type: 'event-removed'; key: string };

export function isPersistedChange(change: MatchChange): boolean {
  return change.type !== 'minute';
}

/**
 * What changed between two snapshots of the same match. Events are compared
 * by key; `nextEvents` undefined means the feed had no event list, so
 * nothing is added or removed.
 */
export function diffMatch(
  prev: MatchSnapshot | null,
  next: MatchSnapshot,
  prevEvents: SnapshotEvent[] = [],
  nextEvents?: SnapshotEvent[],
): MatchChange[] {
  const changes: MatchChange[] = [];

  if (prev && prev.kickoffAt.getTime() !== next.kickoffAt.getTime()) {
    changes.push({ type: 'kickoff', kickoffAt: next.kickoffAt.toISOString() });
  }
  if (!prev || prev.status !== next.status) {
    changes.push({ type: 'status', status: next.status, previous: prev?.status ?? next.status });
  }
  if (!prev || prev.homeScore !== next.homeScore || prev.awayScore !== next.awayScore) {
    if (prev || next.homeScore !== null || next.awayScore !== null) {
      changes.push({ type: 'score', home: next.homeScore, away: next.awayScore });
    }
  }
  if (
    prev &&
    (prev.htHome !== next.htHome || prev.htAway !== next.htAway) &&
    next.htHome !== null
  ) {
    changes.push({ type: 'halftime', home: next.htHome, away: next.htAway });
  }
  if (prev && (prev.penHome !== next.penHome || prev.penAway !== next.penAway)) {
    changes.push({ type: 'penalties', home: next.penHome, away: next.penAway });
  }
  if (prev && (prev.minute !== next.minute || prev.injuryTime !== next.injuryTime)) {
    changes.push({ type: 'minute', minute: next.minute, injuryTime: next.injuryTime });
  }

  if (nextEvents) {
    const before = new Map(prevEvents.map((e) => [e.key, e]));
    const after = new Set(nextEvents.map((e) => e.key));
    for (const event of [...nextEvents].sort(byMatchTime)) {
      const old = before.get(event.key);
      if (!old || !sameEvent(old, event)) changes.push({ type: 'event', event });
    }
    for (const old of prevEvents) {
      if (!after.has(old.key)) changes.push({ type: 'event-removed', key: old.key });
    }
  }

  return changes;
}

function sameEvent(a: SnapshotEvent, b: SnapshotEvent): boolean {
  return (
    a.type === b.type &&
    a.side === b.side &&
    a.minute === b.minute &&
    a.extraMinute === b.extraMinute &&
    a.playerName === b.playerName &&
    a.assistName === b.assistName &&
    a.detail === b.detail
  );
}

export function byMatchTime(a: { minute: number; extraMinute: number | null }, b: typeof a) {
  return a.minute - b.minute || (a.extraMinute ?? 0) - (b.extraMinute ?? 0);
}
