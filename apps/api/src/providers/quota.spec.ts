import { QuotaTracker } from './quota.js';

const T0 = Date.parse('2026-10-10T12:00:00Z');

describe('QuotaTracker', () => {
  it('allows requests until the daily limit, then waits for UTC midnight', () => {
    const q = new QuotaTracker('API_FOOTBALL', { perDay: 3 }, T0);
    for (let i = 0; i < 3; i++) {
      expect(q.waitMs(T0)).toBe(0);
      q.recordRequest(T0);
    }
    expect(q.remainingToday(T0)).toBe(0);
    expect(q.waitMs(T0)).toBe(12 * 60 * 60_000);
  });

  it('resets the daily count on a new UTC day', () => {
    const q = new QuotaTracker('API_FOOTBALL', { perDay: 1 }, T0);
    q.recordRequest(T0);
    const tomorrow = Date.parse('2026-10-11T00:00:01Z');
    expect(q.waitMs(tomorrow)).toBe(0);
    expect(q.remainingToday(tomorrow)).toBe(1);
  });

  it('enforces a per-minute limit with a sliding window', () => {
    const q = new QuotaTracker('FOOTBALL_DATA', { perMinute: 2 }, T0);
    q.recordRequest(T0);
    q.recordRequest(T0 + 10_000);
    expect(q.waitMs(T0 + 20_000)).toBe(40_000);
    expect(q.waitMs(T0 + 60_000)).toBe(0);
  });

  it('backs off exponentially on errors and resets after a success', () => {
    const q = new QuotaTracker('API_FOOTBALL', {}, T0);
    expect(q.recordFailure(T0)).toBe(30_000);
    expect(q.recordFailure(T0)).toBe(60_000);
    expect(q.recordFailure(T0)).toBe(120_000);
    expect(q.waitMs(T0)).toBe(120_000);
    q.recordSuccess();
    expect(q.recordFailure(T0)).toBe(30_000);
  });

  it('caps backoff at 30 minutes and honours Retry-After', () => {
    const q = new QuotaTracker('API_FOOTBALL', {}, T0);
    for (let i = 0; i < 20; i++) q.recordFailure(T0);
    expect(q.waitMs(T0)).toBe(30 * 60_000);
    const r = new QuotaTracker('API_FOOTBALL', {}, T0);
    expect(r.recordFailure(T0, 5_000)).toBe(5_000);
  });

  it('restores a saved count for today only, and trusts the provider', () => {
    const q = new QuotaTracker('API_FOOTBALL', { perDay: 100 }, T0);
    q.restore('2026-10-09', 90);
    expect(q.remainingToday(T0)).toBe(100);
    q.restore('2026-10-10', 40);
    expect(q.remainingToday(T0)).toBe(60);
    q.syncRemaining(20, T0);
    expect(q.remainingToday(T0)).toBe(20);
  });
});
