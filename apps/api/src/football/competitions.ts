/**
 * Competitions Scoreline tracks, in home-page order. Each one names its id
 * at every provider that covers it. Matches from other competitions in the
 * providers' feeds are ignored to keep the database small and relevant.
 *
 * - fdCode: football-data.org code (tables, fixtures, scorers on the free plan)
 * - afId:   API-Football league id (live scores, events, line-ups)
 */
export interface TrackedCompetition {
  slug: string;
  name: string;
  shortName: string;
  country: string;
  type: 'LEAGUE' | 'CUP';
  priority: number;
  fdCode?: string;
  afId?: number;
}

export const TRACKED_COMPETITIONS: readonly TrackedCompetition[] = [
  {
    slug: 'premier-league',
    name: 'Premier League',
    shortName: 'EPL',
    country: 'England',
    type: 'LEAGUE',
    priority: 1,
    fdCode: 'PL',
    afId: 39,
  },
  {
    slug: 'champions-league',
    name: 'UEFA Champions League',
    shortName: 'UCL',
    country: 'Europe',
    type: 'CUP',
    priority: 2,
    fdCode: 'CL',
    afId: 2,
  },
  {
    slug: 'la-liga',
    name: 'La Liga',
    shortName: 'La Liga',
    country: 'Spain',
    type: 'LEAGUE',
    priority: 3,
    fdCode: 'PD',
    afId: 140,
  },
  {
    slug: 'serie-a',
    name: 'Serie A',
    shortName: 'Serie A',
    country: 'Italy',
    type: 'LEAGUE',
    priority: 4,
    fdCode: 'SA',
    afId: 135,
  },
  {
    slug: 'bundesliga',
    name: 'Bundesliga',
    shortName: 'Bundesliga',
    country: 'Germany',
    type: 'LEAGUE',
    priority: 5,
    fdCode: 'BL1',
    afId: 78,
  },
  {
    slug: 'ligue-1',
    name: 'Ligue 1',
    shortName: 'Ligue 1',
    country: 'France',
    type: 'LEAGUE',
    priority: 6,
    fdCode: 'FL1',
    afId: 61,
  },
  {
    slug: 'npfl',
    name: 'Nigeria Premier Football League',
    shortName: 'NPFL',
    country: 'Nigeria',
    type: 'LEAGUE',
    priority: 7,
    afId: 399,
  },
  {
    slug: 'africa-cup-of-nations',
    name: 'Africa Cup of Nations',
    shortName: 'AFCON',
    country: 'Africa',
    type: 'CUP',
    priority: 8,
    afId: 6,
  },
  {
    slug: 'world-cup-qualifiers-africa',
    name: 'World Cup Qualifiers (Africa)',
    shortName: 'WCQ CAF',
    country: 'Africa',
    type: 'CUP',
    priority: 9,
    afId: 29,
  },
  {
    slug: 'world-cup',
    name: 'FIFA World Cup',
    shortName: 'World Cup',
    country: 'World',
    type: 'CUP',
    priority: 10,
    fdCode: 'WC',
    afId: 1,
  },
  {
    slug: 'europa-league',
    name: 'UEFA Europa League',
    shortName: 'UEL',
    country: 'Europe',
    type: 'CUP',
    priority: 11,
    afId: 3,
  },
  {
    slug: 'conference-league',
    name: 'UEFA Conference League',
    shortName: 'UECL',
    country: 'Europe',
    type: 'CUP',
    priority: 12,
    afId: 848,
  },
  {
    slug: 'caf-champions-league',
    name: 'CAF Champions League',
    shortName: 'CAF CL',
    country: 'Africa',
    type: 'CUP',
    priority: 13,
    afId: 12,
  },
  {
    slug: 'nations-league',
    name: 'UEFA Nations League',
    shortName: 'UNL',
    country: 'Europe',
    type: 'CUP',
    priority: 14,
    afId: 5,
  },
  {
    slug: 'world-cup-qualifiers-europe',
    name: 'World Cup Qualifiers (Europe)',
    shortName: 'WCQ UEFA',
    country: 'Europe',
    type: 'CUP',
    priority: 15,
    afId: 32,
  },
  {
    slug: 'championship',
    name: 'Championship',
    shortName: 'EFL Champ',
    country: 'England',
    type: 'LEAGUE',
    priority: 16,
    fdCode: 'ELC',
    afId: 40,
  },
  {
    slug: 'eredivisie',
    name: 'Eredivisie',
    shortName: 'Eredivisie',
    country: 'Netherlands',
    type: 'LEAGUE',
    priority: 17,
    fdCode: 'DED',
    afId: 88,
  },
  {
    slug: 'primeira-liga',
    name: 'Primeira Liga',
    shortName: 'Liga Portugal',
    country: 'Portugal',
    type: 'LEAGUE',
    priority: 18,
    fdCode: 'PPL',
    afId: 94,
  },
  {
    slug: 'brasileirao',
    name: 'Brasileirão Série A',
    shortName: 'Brasileirão',
    country: 'Brazil',
    type: 'LEAGUE',
    priority: 19,
    fdCode: 'BSA',
    afId: 71,
  },
  {
    slug: 'european-championship',
    name: 'UEFA European Championship',
    shortName: 'Euros',
    country: 'Europe',
    type: 'CUP',
    priority: 20,
    fdCode: 'EC',
    afId: 4,
  },
  {
    slug: 'copa-libertadores',
    name: 'Copa Libertadores',
    shortName: 'Libertadores',
    country: 'South America',
    type: 'CUP',
    priority: 21,
    fdCode: 'CLI',
    afId: 13,
  },
  {
    slug: 'international-friendlies',
    name: 'International Friendlies',
    shortName: 'Friendlies',
    country: 'World',
    type: 'CUP',
    priority: 22,
    afId: 10,
  },
];

export const DEMO_COMPETITION = {
  slug: 'scoreline-demo-league',
  name: 'Scoreline Demo League',
  shortName: 'Demo',
  country: 'Demo',
  type: 'LEAGUE' as const,
  priority: 1000,
};

const byAfId = new Map(TRACKED_COMPETITIONS.filter((c) => c.afId).map((c) => [c.afId!, c]));
const byFdCode = new Map(TRACKED_COMPETITIONS.filter((c) => c.fdCode).map((c) => [c.fdCode!, c]));

export function trackedByApiFootballId(id: number): TrackedCompetition | undefined {
  return byAfId.get(id);
}

export function trackedByFootballDataCode(code: string): TrackedCompetition | undefined {
  return byFdCode.get(code);
}
