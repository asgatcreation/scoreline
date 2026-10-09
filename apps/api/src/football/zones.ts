/**
 * Table colour zones (qualification, relegation) per league. Rules change
 * season to season, so these are the usual places, shown as a guide.
 */
type ZoneRule = { from: number; to: number; zone: string };

const RULES: Record<string, (total: number) => ZoneRule[]> = {
  'premier-league': (n) => [
    { from: 1, to: 4, zone: 'champions-league' },
    { from: 5, to: 5, zone: 'europa-league' },
    { from: 6, to: 6, zone: 'conference-league' },
    { from: n - 2, to: n, zone: 'relegation' },
  ],
  'la-liga': (n) => [
    { from: 1, to: 4, zone: 'champions-league' },
    { from: 5, to: 5, zone: 'europa-league' },
    { from: 6, to: 6, zone: 'conference-league' },
    { from: n - 2, to: n, zone: 'relegation' },
  ],
  'serie-a': (n) => [
    { from: 1, to: 4, zone: 'champions-league' },
    { from: 5, to: 5, zone: 'europa-league' },
    { from: 6, to: 6, zone: 'conference-league' },
    { from: n - 2, to: n, zone: 'relegation' },
  ],
  bundesliga: (n) => [
    { from: 1, to: 4, zone: 'champions-league' },
    { from: 5, to: 5, zone: 'europa-league' },
    { from: 6, to: 6, zone: 'conference-league' },
    { from: n - 2, to: n - 2, zone: 'relegation-playoff' },
    { from: n - 1, to: n, zone: 'relegation' },
  ],
  'ligue-1': (n) => [
    { from: 1, to: 3, zone: 'champions-league' },
    { from: 4, to: 4, zone: 'champions-league-qualifying' },
    { from: 5, to: 5, zone: 'europa-league' },
    { from: 6, to: 6, zone: 'conference-league' },
    { from: n - 2, to: n - 2, zone: 'relegation-playoff' },
    { from: n - 1, to: n, zone: 'relegation' },
  ],
  championship: (n) => [
    { from: 1, to: 2, zone: 'promotion' },
    { from: 3, to: 6, zone: 'promotion-playoff' },
    { from: n - 2, to: n, zone: 'relegation' },
  ],
  'champions-league': () => [
    { from: 1, to: 8, zone: 'knockout' },
    { from: 9, to: 24, zone: 'knockout-playoff' },
  ],
  eredivisie: (n) => [
    { from: 1, to: 2, zone: 'champions-league' },
    { from: n - 1, to: n, zone: 'relegation' },
  ],
  'primeira-liga': (n) => [
    { from: 1, to: 2, zone: 'champions-league' },
    { from: n - 1, to: n, zone: 'relegation' },
  ],
  brasileirao: (n) => [
    { from: 1, to: 4, zone: 'libertadores' },
    { from: n - 3, to: n, zone: 'relegation' },
  ],
  npfl: (n) => [
    { from: 1, to: 2, zone: 'caf-champions-league' },
    { from: n - 3, to: n, zone: 'relegation' },
  ],
};

export function zoneFor(competitionSlug: string, position: number, total: number): string | null {
  const rules = RULES[competitionSlug]?.(total) ?? [];
  return rules.find((r) => position >= r.from && position <= r.to)?.zone ?? null;
}
