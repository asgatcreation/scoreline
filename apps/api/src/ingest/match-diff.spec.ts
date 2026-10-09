import { EventType, MatchStatus, Side } from '@scoreline/shared';
import {
  type MatchSnapshot,
  type SnapshotEvent,
  diffMatch,
  isPersistedChange,
} from './match-diff.js';

const base: MatchSnapshot = {
  status: MatchStatus.FirstHalf,
  kickoffAt: new Date('2026-10-10T14:00:00Z'),
  minute: 20,
  injuryTime: null,
  homeScore: 0,
  awayScore: 0,
  htHome: null,
  htAway: null,
  penHome: null,
  penAway: null,
};

const goal: SnapshotEvent = {
  key: 'GOAL|23|0|1|9',
  type: EventType.Goal,
  side: Side.Home,
  minute: 23,
  extraMinute: null,
  playerName: 'Ademola Lookman',
  assistName: null,
  detail: null,
};

describe('diffMatch', () => {
  it('reports nothing when nothing changed', () => {
    expect(diffMatch(base, { ...base }, [goal], [goal])).toEqual([]);
  });

  it('reports a goal as a score change plus a new event', () => {
    const next = { ...base, minute: 23, homeScore: 1 };
    const changes = diffMatch(base, next, [], [goal]);
    expect(changes.map((c) => c.type)).toEqual(['score', 'minute', 'event']);
    expect(changes[0]).toEqual({ type: 'score', home: 1, away: 0 });
  });

  it('reports status changes with the previous status', () => {
    const changes = diffMatch(base, {
      ...base,
      status: MatchStatus.HalfTime,
      htHome: 0,
      htAway: 0,
    });
    expect(changes).toContainEqual({
      type: 'status',
      status: MatchStatus.HalfTime,
      previous: MatchStatus.FirstHalf,
    });
    expect(changes).toContainEqual({ type: 'halftime', home: 0, away: 0 });
  });

  it('reports a goal ruled out by VAR as a removed event', () => {
    const changes = diffMatch({ ...base, homeScore: 1 }, base, [goal], []);
    expect(changes).toContainEqual({ type: 'score', home: 0, away: 0 });
    expect(changes).toContainEqual({ type: 'event-removed', key: goal.key });
  });

  it('re-sends an event whose details were corrected', () => {
    const fixed = { ...goal, assistName: 'Wilfred Ndidi' };
    expect(diffMatch(base, base, [goal], [fixed])).toEqual([{ type: 'event', event: fixed }]);
  });

  it('leaves events alone when the feed has no event list', () => {
    expect(diffMatch(base, base, [goal], undefined)).toEqual([]);
  });

  it('treats a brand-new match as a status change only', () => {
    const scheduled = {
      ...base,
      status: MatchStatus.Scheduled,
      minute: null,
      homeScore: null,
      awayScore: null,
    };
    expect(diffMatch(null, scheduled)).toEqual([
      { type: 'status', status: MatchStatus.Scheduled, previous: MatchStatus.Scheduled },
    ]);
  });

  it('reports a moved kickoff', () => {
    const later = { ...base, kickoffAt: new Date('2026-10-10T16:30:00Z') };
    expect(diffMatch(base, later)[0]).toEqual({
      type: 'kickoff',
      kickoffAt: '2026-10-10T16:30:00.000Z',
    });
  });

  it('does not store minute ticks', () => {
    expect(isPersistedChange({ type: 'minute', minute: 21, injuryTime: null })).toBe(false);
    expect(isPersistedChange({ type: 'score', home: 1, away: 0 })).toBe(true);
  });
});
