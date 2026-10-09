import { findMatchingTeam, nameSimilarity, normaliseTeamName } from './team-matcher.js';

// football-data.org names (with ids) as they appear in each league.
const premierLeague = [
  'Arsenal FC',
  'Aston Villa FC',
  'AFC Bournemouth',
  'Brentford FC',
  'Brighton & Hove Albion FC',
  'Burnley FC',
  'Chelsea FC',
  'Crystal Palace FC',
  'Everton FC',
  'Fulham FC',
  'Leeds United FC',
  'Liverpool FC',
  'Manchester City FC',
  'Manchester United FC',
  'Newcastle United FC',
  'Nottingham Forest FC',
  'Sunderland AFC',
  'Tottenham Hotspur FC',
  'West Ham United FC',
  'Wolverhampton Wanderers FC',
].map((name, i) => ({ id: `pl${i}`, name }));

const laLiga = [
  'Real Madrid CF',
  'FC Barcelona',
  'Club Atlético de Madrid',
  'RCD Espanyol de Barcelona',
  'Rayo Vallecano de Madrid',
  'Real Sociedad de Fútbol',
  'Real Betis Balompié',
  'RC Celta de Vigo',
  'Deportivo Alavés',
  'Athletic Club',
].map((name, i) => ({ id: `ll${i}`, name }));

const ligue1 = [
  'Paris Saint-Germain FC',
  'Paris FC',
  'Olympique Lyonnais',
  'Olympique de Marseille',
  'Stade Rennais FC 1901',
].map((name, i) => ({ id: `l1${i}`, name }));

const serieA = [
  'FC Internazionale Milano',
  'AC Milan',
  'SSC Napoli',
  'Juventus FC',
  'AS Roma',
  'SS Lazio',
].map((name, i) => ({ id: `sa${i}`, name }));

const bundesliga = [
  'FC Bayern München',
  'Borussia Dortmund',
  'Borussia Mönchengladbach',
  '1. FSV Mainz 05',
  'Bayer 04 Leverkusen',
].map((name, i) => ({ id: `bl${i}`, name }));

function match(name: string, candidates: { id: string; name: string }[]) {
  return findMatchingTeam({ name }, candidates)?.name ?? null;
}

describe('normaliseTeamName', () => {
  it('drops accents, punctuation, club suffixes and years', () => {
    expect(normaliseTeamName('Real Sociedad de Fútbol')).toBe('real sociedad');
    expect(normaliseTeamName('1. FSV Mainz 05')).toBe('mainz');
    expect(normaliseTeamName('Brighton & Hove Albion FC')).toBe('brighton hove albion');
  });

  it('applies known aliases', () => {
    expect(normaliseTeamName('FC Internazionale Milano')).toBe('inter');
    expect(normaliseTeamName('Wolverhampton Wanderers FC')).toBe('wolves');
  });
});

describe('findMatchingTeam (API-Football names to football-data.org)', () => {
  it.each([
    ['Brighton', 'Brighton & Hove Albion FC'],
    ['Manchester City', 'Manchester City FC'],
    ['Manchester United', 'Manchester United FC'],
    ['Wolves', 'Wolverhampton Wanderers FC'],
    ['Tottenham', 'Tottenham Hotspur FC'],
    ['West Ham', 'West Ham United FC'],
    ['Bournemouth', 'AFC Bournemouth'],
    ['Nottingham Forest', 'Nottingham Forest FC'],
  ])('Premier League: %s', (af, fd) => {
    expect(match(af, premierLeague)).toBe(fd);
  });

  it.each([
    ['Real Madrid', 'Real Madrid CF'],
    ['Barcelona', 'FC Barcelona'],
    ['Atletico Madrid', 'Club Atlético de Madrid'],
    ['Espanyol', 'RCD Espanyol de Barcelona'],
    ['Rayo Vallecano', 'Rayo Vallecano de Madrid'],
    ['Real Sociedad', 'Real Sociedad de Fútbol'],
    ['Real Betis', 'Real Betis Balompié'],
    ['Celta Vigo', 'RC Celta de Vigo'],
    ['Alaves', 'Deportivo Alavés'],
  ])('La Liga: %s', (af, fd) => {
    expect(match(af, laLiga)).toBe(fd);
  });

  it.each([
    ['Paris Saint Germain', 'Paris Saint-Germain FC'],
    ['Paris FC', 'Paris FC'],
    ['Lyon', 'Olympique Lyonnais'],
    ['Marseille', 'Olympique de Marseille'],
    ['Rennes', 'Stade Rennais FC 1901'],
    ['Inter', 'FC Internazionale Milano'],
    ['AC Milan', 'AC Milan'],
    ['Napoli', 'SSC Napoli'],
    ['Lazio', 'SS Lazio'],
    ['Bayern München', 'FC Bayern München'],
    ['Borussia Monchengladbach', 'Borussia Mönchengladbach'],
    ['FSV Mainz 05', '1. FSV Mainz 05'],
    ['Bayer Leverkusen', 'Bayer 04 Leverkusen'],
  ])('Other leagues: %s', (af, fd) => {
    expect(match(af, [...ligue1, ...serieA, ...bundesliga])).toBe(fd);
  });

  it('refuses to guess when unsure', () => {
    expect(match('Enyimba', premierLeague)).toBeNull();
    // "Borussia" alone could be Dortmund or Gladbach.
    expect(match('Borussia', bundesliga)).toBeNull();
  });

  it('uses the three-letter code as a tie-breaker', () => {
    const teams = [
      { id: 'a', name: 'Manchester City FC', tla: 'MCI' },
      { id: 'b', name: 'Manchester United FC', tla: 'MUN' },
    ];
    expect(findMatchingTeam({ name: 'Manchester', tla: 'MUN' }, teams)?.id).toBe('b');
  });
});

describe('nameSimilarity', () => {
  it('scores identical names as 1 and unrelated names as 0', () => {
    expect(nameSimilarity('Chelsea FC', 'Chelsea')).toBe(1);
    expect(nameSimilarity('Chelsea', 'Arsenal')).toBe(0);
  });
});
