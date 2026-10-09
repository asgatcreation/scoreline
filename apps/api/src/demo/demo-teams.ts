/**
 * Fictional clubs for demo matches. Names are invented so no real club or
 * player is ever shown with made-up results.
 */
export interface DemoTeam {
  slug: string;
  name: string;
  shortName: string;
  tla: string;
  primaryColor: string;
  secondaryColor: string;
  city: string;
  stadium: string;
  coach: string;
  /** 0.8 (weaker) .. 1.25 (stronger); shapes scores and possession. */
  strength: number;
}

export const DEMO_TEAMS: readonly DemoTeam[] = [
  {
    slug: 'demo-lagoon-city',
    name: 'Lagoon City',
    shortName: 'Lagoon',
    tla: 'LGC',
    primaryColor: '#0EA5E9',
    secondaryColor: '#F8FAFC',
    city: 'Lagoon City',
    stadium: 'Marina Park',
    coach: 'Tunde Bakare',
    strength: 1.2,
  },
  {
    slug: 'demo-harmattan-fc',
    name: 'Harmattan FC',
    shortName: 'Harmattan',
    tla: 'HMT',
    primaryColor: '#F59E0B',
    secondaryColor: '#1F2937',
    city: 'Dunewell',
    stadium: 'Dustbowl Arena',
    coach: 'Ibrahim Danladi',
    strength: 1.0,
  },
  {
    slug: 'demo-savannah-united',
    name: 'Savannah United',
    shortName: 'Savannah',
    tla: 'SAV',
    primaryColor: '#16A34A',
    secondaryColor: '#FDE047',
    city: 'Grassvale',
    stadium: 'Acacia Ground',
    coach: 'Chidi Okafor',
    strength: 1.1,
  },
  {
    slug: 'demo-atlantic-rovers',
    name: 'Atlantic Rovers',
    shortName: 'Rovers',
    tla: 'ATR',
    primaryColor: '#1D4ED8',
    secondaryColor: '#FFFFFF',
    city: 'Port Seabright',
    stadium: 'Harbour Road',
    coach: 'Marcus Hale',
    strength: 1.05,
  },
  {
    slug: 'demo-delta-stars',
    name: 'Delta Stars',
    shortName: 'Delta',
    tla: 'DLS',
    primaryColor: '#7C3AED',
    secondaryColor: '#FACC15',
    city: 'Rivermouth',
    stadium: 'Creekside Stadium',
    coach: 'Ebi Tamuno',
    strength: 0.95,
  },
  {
    slug: 'demo-northern-comets',
    name: 'Northern Comets',
    shortName: 'Comets',
    tla: 'NCO',
    primaryColor: '#DC2626',
    secondaryColor: '#111827',
    city: 'Highridge',
    stadium: 'Comet Dome',
    coach: 'Aminu Garba',
    strength: 0.9,
  },
  {
    slug: 'demo-coastal-royals',
    name: 'Coastal Royals',
    shortName: 'Royals',
    tla: 'CRY',
    primaryColor: '#9333EA',
    secondaryColor: '#E5E7EB',
    city: 'Bayshore',
    stadium: 'Crown Park',
    coach: 'Rafael Duarte',
    strength: 1.15,
  },
  {
    slug: 'demo-riverside-wanderers',
    name: 'Riverside Wanderers',
    shortName: 'Wanderers',
    tla: 'RVW',
    primaryColor: '#0F766E',
    secondaryColor: '#FDBA74',
    city: 'Millford',
    stadium: 'Old Mill Lane',
    coach: 'Kwame Asante',
    strength: 0.85,
  },
  {
    slug: 'demo-sahel-strikers',
    name: 'Sahel Strikers',
    shortName: 'Strikers',
    tla: 'SHS',
    primaryColor: '#EA580C',
    secondaryColor: '#FFFFFF',
    city: 'Sandmere',
    stadium: 'Sunrise Field',
    coach: 'Moussa Diallo',
    strength: 0.95,
  },
  {
    slug: 'demo-highland-athletic',
    name: 'Highland Athletic',
    shortName: 'Highland',
    tla: 'HLA',
    primaryColor: '#334155',
    secondaryColor: '#38BDF8',
    city: 'Cloudpeak',
    stadium: 'Summit Park',
    coach: 'Ewan Fraser',
    strength: 1.0,
  },
];

const FIRST = [
  'Ademola',
  'Chinedu',
  'Tobi',
  'Femi',
  'Ikenna',
  'Sani',
  'Yusuf',
  'Emeka',
  'Kunle',
  'Obinna',
  'Lucas',
  'Mateo',
  'Noah',
  'Ethan',
  'Luca',
  'Hugo',
  'Kofi',
  'Moussa',
  'Ivan',
  'Theo',
  'Rafael',
  'Diego',
  'Samuel',
  'Daniel',
  'Joel',
  'Victor',
  'Seun',
  'Bayo',
  'Uche',
  'Jamal',
];

const LAST = [
  'Adeyemi',
  'Okonkwo',
  'Balogun',
  'Eze',
  'Nwosu',
  'Abubakar',
  'Okoro',
  'Ogunleye',
  'Afolabi',
  'Mensah',
  'Diallo',
  'Traoré',
  'Silva',
  'Costa',
  'Moreau',
  'Bianchi',
  'Novak',
  'Hughes',
  'Fischer',
  'Larsen',
  'Duarte',
  'Kamara',
  'Osei',
  'Ndiaye',
  'Ibe',
  'Lawal',
  'Ojo',
  'Yeboah',
];

export interface DemoPlayer {
  name: string;
  number: number;
  position: 'G' | 'D' | 'M' | 'F';
}

/** A fixed 18-player squad per team, derived from its index. */
export function demoSquad(teamIndex: number): DemoPlayer[] {
  const rand = mulberry32(9_001 + teamIndex * 7_919);
  const used = new Set<string>();
  const positions: DemoPlayer['position'][] = [
    'G',
    'D',
    'D',
    'D',
    'D',
    'M',
    'M',
    'M',
    'F',
    'F',
    'F',
    'G',
    'D',
    'D',
    'M',
    'M',
    'F',
    'F',
  ];
  const numbers = [1, 2, 4, 5, 3, 6, 8, 10, 7, 9, 11, 23, 15, 22, 14, 18, 19, 20];
  return positions.map((position, i) => {
    let name = '';
    do {
      name = `${pick(rand, FIRST)} ${pick(rand, LAST)}`;
    } while (used.has(name));
    used.add(name);
    return { name, number: numbers[i]!, position };
  });
}

/** Small, fast, seedable random numbers (same seed = same sequence). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}
