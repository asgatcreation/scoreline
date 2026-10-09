import { describe, expect, it } from 'vitest';
import { addDays, isIsoDate, isValidTimeZone, localDate, localDayRange } from './time.js';

describe('localDayRange', () => {
  it('starts a Lagos day at 23:00 UTC the day before', () => {
    const { start, end } = localDayRange('2026-10-10', 'Africa/Lagos');
    expect(start.toISOString()).toBe('2026-10-09T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-10T23:00:00.000Z');
  });

  it('handles a 25-hour day when London clocks go back', () => {
    const { start, end } = localDayRange('2026-10-25', 'Europe/London');
    expect(start.toISOString()).toBe('2026-10-24T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });

  it('works for UTC', () => {
    expect(localDayRange('2026-01-01', 'UTC').start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('localDate', () => {
  it('rolls a late UTC kickoff into the next Lagos day', () => {
    expect(localDate(new Date('2026-10-09T23:30:00Z'), 'Africa/Lagos')).toBe('2026-10-10');
  });
});

describe('date helpers', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-10-09')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('09-10-2026')).toBe(false);
  });

  it('validates time zones', () => {
    expect(isValidTimeZone('Africa/Lagos')).toBe(true);
    expect(isValidTimeZone('Mars/Base')).toBe(false);
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
