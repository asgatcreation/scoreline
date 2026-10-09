/**
 * Decides how often to poll the live feed so a small daily budget (100
 * requests on the free plan) lasts through every match of the day. Pure
 * functions: everything, including the time, is passed in.
 */

const MINUTE = 60_000;

/** A match is "live-ish" from just before kick-off until well after it. */
export const WINDOW_BEFORE_MS = 5 * MINUTE;
export const WINDOW_AFTER_MS = 130 * MINUTE;

export interface Window {
  start: number;
  end: number;
}

export function matchWindows(kickoffs: number[]): Window[] {
  const sorted = kickoffs
    .map((k) => ({ start: k - WINDOW_BEFORE_MS, end: k + WINDOW_AFTER_MS }))
    .sort((a, b) => a.start - b.start);
  // Merge overlaps so busy afternoons count once.
  const merged: Window[] = [];
  for (const w of sorted) {
    const last = merged.at(-1);
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else merged.push({ ...w });
  }
  return merged;
}

/** Milliseconds of match windows left between now and `until`. */
export function liveTimeRemaining(windows: Window[], now: number, until: number): number {
  let total = 0;
  for (const w of windows) {
    const start = Math.max(w.start, now);
    const end = Math.min(w.end, until);
    if (end > start) total += end - start;
  }
  return total;
}

export interface LivePlanInput {
  windows: Window[];
  now: number;
  /** End of the quota day (next UTC midnight for API-Football). */
  dayEnd: number;
  /** Requests left today; null means no daily cap. */
  remaining: number | null;
  /** Requests to keep for fixtures-by-date and match details. */
  reserved: number;
  minIntervalMs?: number;
  maxIntervalMs?: number;
}

export type LivePlan =
  | { action: 'poll'; nextInMs: number }
  | { action: 'wait'; nextInMs: number; reason: 'no-match' | 'no-budget' };

/**
 * When to poll the live feed next. Inside a match window the interval is
 * the live time left divided by the requests left; outside, sleep until the
 * next window opens.
 */
export function planLivePolling(input: LivePlanInput): LivePlan {
  const min = input.minIntervalMs ?? MINUTE;
  const max = input.maxIntervalMs ?? 30 * MINUTE;
  const { windows, now, dayEnd } = input;

  const current = windows.find((w) => w.start <= now && now < w.end);
  if (!current) {
    const next = windows.find((w) => w.start > now);
    const nextInMs = next ? Math.min(next.start - now, max) : max;
    return { action: 'wait', nextInMs, reason: 'no-match' };
  }

  if (input.remaining === null) return { action: 'poll', nextInMs: min };
  const budget = input.remaining - input.reserved;
  if (budget <= 0) {
    return { action: 'wait', nextInMs: Math.max(min, dayEnd - now), reason: 'no-budget' };
  }
  const left = liveTimeRemaining(windows, now, dayEnd);
  const interval = Math.round(left / budget);
  return { action: 'poll', nextInMs: Math.min(max, Math.max(min, interval)) };
}

export function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}
