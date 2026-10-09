import {
  liveTimeRemaining,
  matchWindows,
  nextUtcMidnight,
  planLivePolling,
} from './polling-plan.js';

const MIN = 60_000;
const at = (hhmm: string) => Date.parse(`2026-10-10T${hhmm}:00Z`);
const dayEnd = nextUtcMidnight(at('12:00'));

describe('matchWindows', () => {
  it('merges overlapping matches into one window', () => {
    const windows = matchWindows([at('14:00'), at('12:30'), at('14:00'), at('19:00')]);
    expect(windows).toHaveLength(2);
    expect(windows[0]).toEqual({ start: at('12:25'), end: at('16:10') });
    expect(windows[1]).toEqual({ start: at('18:55'), end: at('21:10') });
  });
});

describe('liveTimeRemaining', () => {
  it('counts only the part of each window still ahead', () => {
    const windows = matchWindows([at('14:00'), at('19:00')]);
    expect(liveTimeRemaining(windows, at('15:00'), dayEnd)).toBe((70 + 135) * MIN);
  });
});

describe('planLivePolling', () => {
  // A typical Saturday: 12:30, 15:00 and 17:30 kick-offs.
  const saturday = matchWindows([at('11:30'), at('14:00'), at('16:30')]);

  it('waits for the next match when nothing is on', () => {
    const plan = planLivePolling({
      windows: saturday,
      now: at('09:00'),
      dayEnd,
      remaining: 90,
      reserved: 20,
    });
    expect(plan).toEqual({ action: 'wait', nextInMs: 30 * MIN, reason: 'no-match' });
    const soon = planLivePolling({
      windows: saturday,
      now: at('11:15'),
      dayEnd,
      remaining: 90,
      reserved: 20,
    });
    expect(soon).toEqual({ action: 'wait', nextInMs: 10 * MIN, reason: 'no-match' });
  });

  it('spreads the remaining budget over the remaining live time', () => {
    // Three windows of 135 minutes, 5 already gone: 400 minutes, 70 requests.
    const plan = planLivePolling({
      windows: saturday,
      now: at('11:30'),
      dayEnd,
      remaining: 90,
      reserved: 20,
    });
    expect(plan.action).toBe('poll');
    expect(plan.nextInMs).toBe(Math.round((400 * MIN) / 70));
  });

  it('never polls faster than once a minute', () => {
    const plan = planLivePolling({
      windows: saturday,
      now: at('18:30'),
      dayEnd,
      remaining: 90,
      reserved: 0,
    });
    expect(plan).toEqual({ action: 'poll', nextInMs: MIN });
  });

  it('stops polling when only the reserve is left', () => {
    const plan = planLivePolling({
      windows: saturday,
      now: at('15:00'),
      dayEnd,
      remaining: 10,
      reserved: 10,
    });
    expect(plan).toMatchObject({ action: 'wait', reason: 'no-budget' });
    expect(plan.nextInMs).toBe(dayEnd - at('15:00'));
  });

  it('polls every minute when the provider has no daily cap', () => {
    const plan = planLivePolling({
      windows: saturday,
      now: at('12:00'),
      dayEnd,
      remaining: null,
      reserved: 0,
    });
    expect(plan).toEqual({ action: 'poll', nextInMs: MIN });
  });

  it('a whole Saturday on the free plan fits in the budget', () => {
    let now = at('00:00');
    let remaining = 100;
    const reserved = 25;
    let polls = 0;
    while (now < dayEnd) {
      const plan = planLivePolling({ windows: saturday, now, dayEnd, remaining, reserved });
      if (plan.action === 'poll') {
        polls++;
        remaining--;
      }
      now += plan.nextInMs;
    }
    expect(remaining).toBeGreaterThanOrEqual(reserved);
    expect(polls).toBeGreaterThan(60);
  });
});
