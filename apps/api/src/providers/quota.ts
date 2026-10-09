import type { ProviderName } from './types.js';

export interface QuotaLimits {
  perDay?: number;
  perMinute?: number;
}

export interface QuotaSnapshot {
  provider: ProviderName;
  day: string;
  usedToday: number;
  limitPerDay: number | null;
  remainingToday: number | null;
  usedLastMinute: number;
  limitPerMinute: number | null;
  backoffUntil: string | null;
  consecutiveErrors: number;
}

const MINUTE = 60_000;
const BASE_BACKOFF = 30_000;
const MAX_BACKOFF = 30 * MINUTE;

/**
 * Counts requests per provider against its plan limits and decides when we
 * must wait. Pure bookkeeping (time is passed in), so it is easy to test;
 * the HTTP client persists the daily count.
 */
export class QuotaTracker {
  private day: string;
  private usedToday = 0;
  private recent: number[] = [];
  private backoffUntil = 0;
  private consecutiveErrors = 0;

  constructor(
    readonly provider: ProviderName,
    private readonly limits: QuotaLimits,
    now: number = Date.now(),
  ) {
    this.day = utcDay(now);
  }

  /** Restore the count saved earlier today (after a restart or sleep). */
  restore(day: string, used: number): void {
    if (day === this.day) this.usedToday = Math.max(this.usedToday, used);
  }

  /** The provider told us how many it has left; trust it over our count. */
  syncRemaining(remaining: number, now: number = Date.now()): void {
    this.rollDay(now);
    if (this.limits.perDay !== undefined) {
      this.usedToday = Math.max(this.usedToday, this.limits.perDay - remaining);
    }
  }

  /** Milliseconds to wait before the next request may go out (0 = now). */
  waitMs(now: number = Date.now()): number {
    this.rollDay(now);
    if (now < this.backoffUntil) return this.backoffUntil - now;
    if (this.limits.perDay !== undefined && this.usedToday >= this.limits.perDay) {
      return nextUtcMidnight(now) - now;
    }
    if (this.limits.perMinute !== undefined) {
      this.recent = this.recent.filter((t) => now - t < MINUTE);
      if (this.recent.length >= this.limits.perMinute) {
        return this.recent[0]! + MINUTE - now;
      }
    }
    return 0;
  }

  remainingToday(now: number = Date.now()): number | null {
    this.rollDay(now);
    return this.limits.perDay === undefined
      ? null
      : Math.max(0, this.limits.perDay - this.usedToday);
  }

  recordRequest(now: number = Date.now()): void {
    this.rollDay(now);
    this.usedToday += 1;
    this.recent.push(now);
  }

  recordSuccess(): void {
    this.consecutiveErrors = 0;
  }

  /**
   * Exponential backoff: 30s, 1m, 2m ... capped at 30m. A rate-limit reply
   * (HTTP 429) may tell us exactly how long to wait.
   */
  recordFailure(now: number = Date.now(), retryAfterMs?: number): number {
    this.consecutiveErrors += 1;
    const backoff =
      retryAfterMs ?? Math.min(MAX_BACKOFF, BASE_BACKOFF * 2 ** (this.consecutiveErrors - 1));
    this.backoffUntil = Math.max(this.backoffUntil, now + backoff);
    return backoff;
  }

  snapshot(now: number = Date.now()): QuotaSnapshot {
    this.rollDay(now);
    this.recent = this.recent.filter((t) => now - t < MINUTE);
    return {
      provider: this.provider,
      day: this.day,
      usedToday: this.usedToday,
      limitPerDay: this.limits.perDay ?? null,
      remainingToday: this.remainingToday(now),
      usedLastMinute: this.recent.length,
      limitPerMinute: this.limits.perMinute ?? null,
      backoffUntil: this.backoffUntil > now ? new Date(this.backoffUntil).toISOString() : null,
      consecutiveErrors: this.consecutiveErrors,
    };
  }

  get today(): string {
    return this.day;
  }

  private rollDay(now: number): void {
    const day = utcDay(now);
    if (day !== this.day) {
      this.day = day;
      this.usedToday = 0;
    }
  }
}

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}
