import { describe, expect, it } from 'vitest';
import { MatchStatus, isClockRunning, isEnded, isLive, statusShortLabel } from './match-status.js';

describe('match status helpers', () => {
  it('treats half-time as live but not as a running clock', () => {
    expect(isLive(MatchStatus.HalfTime)).toBe(true);
    expect(isClockRunning(MatchStatus.HalfTime)).toBe(false);
  });

  it('treats a postponed match as neither live nor ended', () => {
    expect(isLive(MatchStatus.Postponed)).toBe(false);
    expect(isEnded(MatchStatus.Postponed)).toBe(false);
  });

  it('marks finished matches as ended', () => {
    expect(isEnded(MatchStatus.Finished)).toBe(true);
    expect(isLive(MatchStatus.Finished)).toBe(false);
  });

  it('has a short label for every status', () => {
    for (const status of Object.values(MatchStatus)) {
      expect(statusShortLabel(status)).toMatch(/^[A-Z0-9]+$/);
    }
  });
});
