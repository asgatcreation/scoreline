import { describe, expect, it } from 'vitest';
import type { MatchSummary } from './api-types.js';
import { applyDeltas, isGoalDelta, isRoomName } from './realtime.js';

const summary = {
  id: 'm1',
  status: 'FIRST_HALF',
  minute: 20,
  injuryTime: null,
  score: { home: 0, away: 0 },
  halfTime: { home: null, away: null },
  penalties: null,
  kickoffAt: '2026-10-10T14:00:00.000Z',
} as MatchSummary;

describe('isRoomName', () => {
  it('accepts the three room kinds', () => {
    expect(isRoomName('live')).toBe(true);
    expect(isRoomName('match:arsenal-vs-leeds-united-2026-10-10')).toBe(true);
    expect(isRoomName('competition:premier-league')).toBe(true);
  });

  it('rejects anything else', () => {
    for (const bad of [
      '',
      'Live',
      'match:',
      'match:../x',
      'team:arsenal',
      42,
      null,
      'match:' + 'a'.repeat(200),
    ]) {
      expect(isRoomName(bad)).toBe(false);
    }
  });
});

describe('applyDeltas', () => {
  it('updates score, minute and status without mutating the input', () => {
    const next = applyDeltas(summary, [
      { type: 'score', home: 1, away: 0 },
      { type: 'minute', minute: 23, injuryTime: null },
      { type: 'status', status: 'HALF_TIME', previous: 'FIRST_HALF' },
    ]);
    expect(next).toMatchObject({ score: { home: 1, away: 0 }, minute: 23, status: 'HALF_TIME' });
    expect(summary.score.home).toBe(0);
  });
});

describe('isGoalDelta', () => {
  it('spots goals but not cards', () => {
    const event = {
      key: 'k',
      side: 'HOME',
      minute: 5,
      extraMinute: null,
      playerName: 'A',
      assistName: null,
      detail: null,
    } as const;
    expect(isGoalDelta({ type: 'event', event: { ...event, type: 'PENALTY_GOAL' } })).toBe(true);
    expect(isGoalDelta({ type: 'event', event: { ...event, type: 'YELLOW_CARD' } })).toBe(false);
    expect(isGoalDelta({ type: 'score', home: 1, away: 0 })).toBe(false);
  });
});
