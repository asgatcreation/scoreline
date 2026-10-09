/** Default timezone for Scoreline: fans in Nigeria. */
export const DEFAULT_TIMEZONE = 'Africa/Lagos';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offset of `tz` from UTC at `instant`, in minutes (Lagos = +60). */
export function timeZoneOffsetMinutes(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The UTC instants where a local calendar day starts and ends in `tz`.
 * `end` is exclusive. Handles daylight-saving days (23 or 25 hours).
 */
export function localDayRange(date: string, tz: string): { start: Date; end: Date } {
  return { start: localMidnight(date, tz), end: localMidnight(addDays(date, 1), tz) };
}

function localMidnight(date: string, tz: string): Date {
  const guess = new Date(`${date}T00:00:00Z`);
  // A second pass settles the offset when midnight is near a DST switch.
  const first = new Date(guess.getTime() - timeZoneOffsetMinutes(guess, tz) * 60_000);
  return new Date(guess.getTime() - timeZoneOffsetMinutes(first, tz) * 60_000);
}

/** Calendar date (YYYY-MM-DD) of `instant` as seen in `tz`. */
export function localDate(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
