import { matchSlug, slugify, uniqueSlug } from './slug.js';

describe('slugs', () => {
  it('makes readable team slugs', () => {
    expect(slugify('Brighton & Hove Albion FC')).toBe('brighton-hove-albion');
    expect(slugify('Club Atlético de Madrid')).toBe('club-atletico-de-madrid');
    expect(slugify('AFC Bournemouth')).toBe('bournemouth');
    expect(slugify('1. FC Köln')).toBe('1-koln');
  });

  it('makes match slugs from teams and date', () => {
    expect(matchSlug('arsenal', 'leeds-united', new Date('2026-10-10T11:30:00Z'))).toBe(
      'arsenal-vs-leeds-united-2026-10-10',
    );
  });

  it('adds a number when a slug is taken', () => {
    const taken = new Set(['enyimba', 'enyimba-2']);
    expect(uniqueSlug('enyimba', (s) => taken.has(s))).toBe('enyimba-3');
    expect(uniqueSlug('rangers', (s) => taken.has(s))).toBe('rangers');
  });
});
