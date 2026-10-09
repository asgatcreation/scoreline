/**
 * Links the same club across providers: football-data.org says
 * "Brighton & Hove Albion FC", API-Football says "Brighton". Candidates are
 * limited to one competition, which keeps fuzzy matching safe.
 */

/** Words that say nothing about which club it is. */
const NOISE = new Set([
  'fc',
  'afc',
  'cf',
  'sc',
  'ac',
  'acf',
  'ssc',
  'ss',
  'as',
  'us',
  'cfc',
  'bc',
  'rcd',
  'rc',
  'ca',
  'ud',
  'cd',
  'sd',
  'sv',
  'vfl',
  'vfb',
  'tsg',
  'fsv',
  'club',
  'de',
  'del',
  'la',
  'le',
  'calcio',
  'balompie',
  'futbol',
  'football',
  'the',
  'and',
  'cp',
  'sl',
  'ec',
  'se',
  'kv',
  'krc',
]);

/** Different names for the same club, after normalising. */
const ALIASES: Record<string, string> = {
  internazionale: 'inter',
  'internazionale milano': 'inter',
  'wolverhampton wanderers': 'wolves',
  'olympique lyonnais': 'lyon',
  'stade rennais': 'rennes',
  'paris saint germain': 'psg',
  'bayern munchen': 'bayern munich',
  'nottm forest': 'nottingham forest',
  'man utd': 'manchester united',
  'man united': 'manchester united',
  'man city': 'manchester city',
  spurs: 'tottenham',
  'sporting cp': 'sporting',
  'sporting clube portugal': 'sporting',
};

export function normaliseTeamName(name: string): string {
  const plain = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = plain.split(' ').filter((t) => t && !NOISE.has(t) && !/^\d+$/.test(t));
  const joined = tokens.join(' ');
  return ALIASES[joined] ?? joined;
}

function tokens(name: string): Set<string> {
  return new Set(normaliseTeamName(name).split(' ').filter(Boolean));
}

export interface TeamCandidate {
  id: string;
  name: string;
  shortName?: string | null;
  tla?: string | null;
}

/**
 * How alike two names are (0..1). 1 = same words. A short name fully
 * contained in a long one ("Brighton" in "Brighton Hove Albion") scores
 * well but below an exact match, so "Paris FC" never beats "Paris FC" by
 * accident with "Paris Saint-Germain".
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  if (shared === 0) return 0;
  const jaccard = shared / (ta.size + tb.size - shared);
  const contained = shared === Math.min(ta.size, tb.size);
  return contained ? Math.max(jaccard, 0.5 + jaccard / 2) : jaccard;
}

/**
 * The candidate that is clearly the same club, or null when unsure. Being
 * unsure is fine: the team is created separately and can be linked later.
 */
export function findMatchingTeam(
  team: { name: string; shortName?: string | null; tla?: string | null },
  candidates: TeamCandidate[],
): TeamCandidate | null {
  const scored = candidates
    .map((c) => {
      let score = 0;
      for (const a of [team.name, team.shortName]) {
        for (const b of [c.name, c.shortName]) {
          if (a && b) score = Math.max(score, nameSimilarity(a, b));
        }
      }
      if (team.tla && c.tla && team.tla === c.tla) score = Math.min(1, score + 0.15);
      return { c, score };
    })
    .sort((x, y) => y.score - x.score);

  const [best, second] = scored;
  if (!best || best.score < 0.6) return null;
  if (second && best.score - second.score < 0.1) return null;
  return best.c;
}
