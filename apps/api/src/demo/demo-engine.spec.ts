import { EventType, MatchStatus, Side, isGoalEvent } from '@scoreline/shared';
import {
  SLOT_MS,
  kickoffOf,
  matchLength,
  scriptFor,
  slotsBetween,
  stateAt,
} from './demo-engine.js';

const MIN = 60_000;

describe('demo engine', () => {
  const slot = 735_000;
  const script = scriptFor(slot);
  const ko = script.kickoffAt.getTime();

  it('is deterministic: the same slot always gives the same match', () => {
    const again = scriptFor(slot + 0);
    expect(again.homeIndex).toBe(script.homeIndex);
    expect(again.events.map((e) => e.key)).toEqual(script.events.map((e) => e.key));
    expect(stateAt(script, ko + 70 * MIN)).toEqual(stateAt(again, ko + 70 * MIN));
  });

  it('never plays a team against itself and kicks off on its slot', () => {
    for (let k = slot; k < slot + 50; k++) {
      const s = scriptFor(k);
      expect(s.homeIndex).not.toBe(s.awayIndex);
      expect(s.kickoffAt.getTime()).toBe(k * SLOT_MS);
    }
  });

  it('walks through every phase of a match', () => {
    expect(stateAt(script, ko - MIN).status).toBe(MatchStatus.Scheduled);
    const early = stateAt(script, ko + 10.2 * MIN);
    expect(early).toMatchObject({ status: MatchStatus.FirstHalf, minute: 11, injuryTime: null });
    expect(early.periodStartedAt).toEqual(script.kickoffAt);

    const stoppage = stateAt(script, ko + 45.5 * MIN);
    expect(stoppage).toMatchObject({ status: MatchStatus.FirstHalf, minute: 45, injuryTime: 1 });

    const ht = stateAt(script, ko + (45 + script.inj1 + 5) * MIN);
    expect(ht.status).toBe(MatchStatus.HalfTime);
    expect(ht.htHome).not.toBeNull();

    const secondHalf = stateAt(script, ko + (60 + script.inj1 + 10) * MIN);
    expect(secondHalf).toMatchObject({ status: MatchStatus.SecondHalf, minute: 56 });

    const ft = stateAt(script, ko + (matchLength(script) + 1) * MIN);
    expect(ft.status).toBe(MatchStatus.Finished);
    expect(ft.minute).toBeNull();
    expect(ft.events).toHaveLength(script.events.length);
  });

  it('keeps the score equal to the goals shown so far', () => {
    for (let k = slot; k < slot + 30; k++) {
      const s = scriptFor(k);
      for (let m = 0; m <= matchLength(s); m += 7) {
        const st = stateAt(s, s.kickoffAt.getTime() + m * MIN);
        if (st.status === MatchStatus.Scheduled) continue;
        const goals = st.events.filter((e) => isGoalEvent(e.type));
        expect(st.homeScore).toBe(goals.filter((e) => e.side === Side.Home).length);
        expect(st.awayScore).toBe(goals.filter((e) => e.side === Side.Away).length);
      }
    }
  });

  it('only lets players on the pitch score', () => {
    for (let k = slot; k < slot + 40; k++) {
      const s = scriptFor(k);
      for (const goal of s.events.filter((e) => e.type === EventType.Goal)) {
        const subbedOff = s.events.find(
          (e) =>
            e.type === EventType.Substitution &&
            e.side === goal.side &&
            e.assistName === goal.playerName,
        );
        if (subbedOff) expect(goal.minute).toBeLessThan(subbedOff.minute);
      }
    }
  });

  it('gives events unique keys and full line-ups', () => {
    const keys = script.events.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const lineup of script.lineups) {
      expect(lineup.players.filter((p) => p.isStarter)).toHaveLength(11);
      expect(lineup.players[0]).toMatchObject({ position: 'G', grid: '1:1' });
    }
  });

  it('announces line-ups an hour before kick-off', () => {
    expect(stateAt(script, ko - 90 * MIN).lineups).toEqual([]);
    expect(stateAt(script, ko - 30 * MIN).lineups).toHaveLength(2);
  });

  it('always has about three matches in play', () => {
    const now = kickoffOf(slot).getTime() + 17 * MIN;
    const live = slotsBetween(now - 120 * MIN, now + 1).filter((k) => {
      const st = stateAt(scriptFor(k), now).status;
      return st !== MatchStatus.Scheduled && st !== MatchStatus.Finished;
    });
    expect(live.length).toBeGreaterThanOrEqual(2);
    expect(live.length).toBeLessThanOrEqual(3);
  });

  it('produces realistic scores over many matches', () => {
    let goals = 0;
    const n = 400;
    for (let k = 0; k < n; k++) {
      const s = scriptFor(slot + 1000 + k);
      goals += s.events.filter((e) => isGoalEvent(e.type)).length;
    }
    const perMatch = goals / n;
    expect(perMatch).toBeGreaterThan(2);
    expect(perMatch).toBeLessThan(3.4);
  });
});
