import { describe, expect, it } from 'vitest';
import { formatMinute } from './minute.js';

describe('formatMinute', () => {
  it('formats a normal minute', () => {
    expect(formatMinute(67)).toBe("67'");
  });

  it('formats stoppage time', () => {
    expect(formatMinute(45, 2)).toBe("45+2'");
  });

  it('ignores zero or missing stoppage time', () => {
    expect(formatMinute(90, 0)).toBe("90'");
    expect(formatMinute(90, null)).toBe("90'");
  });

  it('returns an empty string for invalid minutes', () => {
    expect(formatMinute(-1)).toBe('');
    expect(formatMinute(Number.NaN)).toBe('');
  });
});
