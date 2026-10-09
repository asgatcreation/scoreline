import { EventType, MatchStatus, Side, isGoalEvent } from '@scoreline/shared';
import type { SnapshotEvent } from '../ingest/match-diff.js';
import { DEMO_TEAMS, type DemoPlayer, demoSquad, mulberry32, pick } from './demo-teams.js';

/**
 * Demo matches are a pure function of time: slot k kicks off at
 * k * SLOT_MS, and its state at any instant is computed from a script
 * seeded by k. Restarts, sleeps and multiple servers all agree, with no
 * storage and nothing to catch up.
 */
export const SLOT_MS = 40 * 60_000;
const MINUTE_MS = 60_000;
const HALF_TIME_BREAK = 15;
/** Line-ups are announced an hour before kick-off, like real matches. */
const LINEUPS_BEFORE_MS = 60 * MINUTE_MS;

export interface DemoEvent extends SnapshotEvent {
  /** Real minutes after kick-off when it happens. */
  at: number;
}

export interface DemoLineup {
  side: Side;
  formation: string;
  coachName: string;
  players: {
    name: string;
    number: number;
    position: string;
    grid: string | null;
    isStarter: boolean;
  }[];
}

export interface DemoScript {
  slot: number;
  id: string;
  slug: string;
  homeIndex: number;
  awayIndex: number;
  kickoffAt: Date;
  /** Stoppage minutes in each half. */
  inj1: number;
  inj2: number;
  referee: string;
  events: DemoEvent[];
  lineups: DemoLineup[];
  finalStats: DemoStat[];
}

export interface DemoStat {
  type: string;
  home: number;
  away: number;
  unit: string | null;
}

export interface DemoState {
  status: MatchStatus;
  minute: number | null;
  injuryTime: number | null;
  periodStartedAt: Date | null;
  homeScore: number | null;
  awayScore: number | null;
  htHome: number | null;
  htAway: number | null;
  events: DemoEvent[];
  stats: DemoStat[];
  lineups: DemoLineup[];
}

const FORMATIONS = ['4-3-3', '4-2-3-1', '4-4-2', '3-5-2'];
const REFEREES = [
  'Daniel Okpara',
  'Sofia Marquez',
  'Kwesi Boateng',
  'Anna Lindqvist',
  'Bashir Yakubu',
  'Paolo Ricci',
];

export function slotAt(instant: number): number {
  return Math.floor(instant / SLOT_MS);
}

export function kickoffOf(slot: number): Date {
  return new Date(slot * SLOT_MS);
}

/** Every slot whose kick-off falls in [from, to). */
export function slotsBetween(from: number, to: number): number[] {
  const out: number[] = [];
  for (let k = Math.ceil(from / SLOT_MS); k * SLOT_MS < to; k++) out.push(k);
  return out;
}

/** Real minutes from kick-off to the final whistle. */
export function matchLength(script: Pick<DemoScript, 'inj1' | 'inj2'>): number {
  return 45 + script.inj1 + HALF_TIME_BREAK + 45 + script.inj2;
}

const cache = new Map<number, DemoScript>();

export function scriptFor(slot: number): DemoScript {
  const hit = cache.get(slot);
  if (hit) return hit;
  const script = buildScript(slot);
  cache.set(slot, script);
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return script;
}

function buildScript(slot: number): DemoScript {
  const rand = mulberry32(slot * 2_654_435_761);
  const homeIndex = Math.floor(rand() * DEMO_TEAMS.length);
  let awayIndex = Math.floor(rand() * (DEMO_TEAMS.length - 1));
  if (awayIndex >= homeIndex) awayIndex++;
  const home = DEMO_TEAMS[homeIndex]!;
  const away = DEMO_TEAMS[awayIndex]!;
  const kickoffAt = kickoffOf(slot);
  const inj1 = 1 + Math.floor(rand() * 4);
  const inj2 = 2 + Math.floor(rand() * 5);

  const sides = {
    [Side.Home]: new SideBuilder(Side.Home, homeIndex, rand),
    [Side.Away]: new SideBuilder(Side.Away, awayIndex, rand),
  };
  const raw: Omit<DemoEvent, 'at' | 'key'>[] = [];

  // Substitutions first, so scorers are always players on the pitch.
  for (const side of [Side.Home, Side.Away]) raw.push(...sides[side].substitutions());

  const homeGoals = poisson(rand, 1.35 * home.strength * (1 / Math.sqrt(away.strength)) + 0.15);
  const awayGoals = poisson(rand, 1.1 * away.strength * (1 / Math.sqrt(home.strength)));
  for (const [side, count] of [
    [Side.Home, homeGoals],
    [Side.Away, awayGoals],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const { minute, extraMinute } = randomMinute(rand, inj1, inj2);
      const roll = rand();
      const type =
        roll < 0.05 ? EventType.OwnGoal : roll < 0.15 ? EventType.PenaltyGoal : EventType.Goal;
      // An own goal is scored by the other side's player but counts for `side`.
      const scorerSide = type === EventType.OwnGoal ? other(side) : side;
      const scorer = sides[scorerSide].onPitch(minute, ['F', 'F', 'F', 'M', 'M', 'D'], rand);
      const assist =
        type === EventType.Goal && rand() < 0.7
          ? sides[side].onPitch(minute, ['M', 'M', 'F', 'D'], rand, scorer)
          : null;
      raw.push({
        type,
        side,
        minute,
        extraMinute,
        playerName: scorer,
        assistName: assist,
        detail: null,
      });
    }
  }

  const yellows = poisson(rand, 3.4);
  for (let i = 0; i < yellows; i++) {
    const side = rand() < 0.5 ? Side.Home : Side.Away;
    const { minute, extraMinute } = randomMinute(rand, inj1, inj2);
    const player = sides[side].onPitch(minute, ['D', 'D', 'M', 'M', 'F'], rand);
    raw.push({
      type: EventType.YellowCard,
      side,
      minute,
      extraMinute,
      playerName: player,
      assistName: null,
      detail: null,
    });
  }
  if (rand() < 0.08) {
    const side = rand() < 0.5 ? Side.Home : Side.Away;
    const minute = 30 + Math.floor(rand() * 58);
    const player = sides[side].onPitch(minute, ['D', 'M'], rand);
    raw.push({
      type: EventType.RedCard,
      side,
      minute,
      extraMinute: null,
      playerName: player,
      assistName: null,
      detail: null,
    });
  }
  if (rand() < 0.07) {
    const side = rand() < 0.5 ? Side.Home : Side.Away;
    const minute = 10 + Math.floor(rand() * 78);
    const player = sides[side].onPitch(minute, ['F', 'M'], rand);
    raw.push({
      type: EventType.MissedPenalty,
      side,
      minute,
      extraMinute: null,
      playerName: player,
      assistName: null,
      detail: 'Saved by the goalkeeper',
    });
  }
  if (rand() < 0.18) {
    const side = rand() < 0.5 ? Side.Home : Side.Away;
    const minute = 5 + Math.floor(rand() * 83);
    const player = sides[side].onPitch(minute, ['F', 'F', 'M'], rand);
    raw.push({
      type: EventType.Var,
      side,
      minute,
      extraMinute: null,
      playerName: player,
      assistName: null,
      detail: pick(rand, [
        'Goal disallowed - offside',
        'Goal disallowed - handball',
        'Penalty cancelled',
      ]),
    });
  }

  const seen = new Map<string, number>();
  const events = raw
    .map((e) => {
      const base = `${e.type}|${e.side}|${e.minute}|${e.extraMinute ?? 0}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return { ...e, key: `${base}|${n}`, at: clockOf(e.minute, e.extraMinute, inj1) };
    })
    .sort((a, b) => a.at - b.at);

  return {
    slot,
    id: `demo-${slot}`,
    slug: `demo-${home.slug.slice(5)}-vs-${away.slug.slice(5)}-${slot}`,
    homeIndex,
    awayIndex,
    kickoffAt,
    inj1,
    inj2,
    referee: pick(rand, REFEREES),
    events,
    lineups: [sides[Side.Home].lineup(), sides[Side.Away].lineup()],
    finalStats: finalStats(rand, home.strength, away.strength, events),
  };
}

/** Real minutes after kick-off when match minute `minute` (+extra) is played. */
function clockOf(minute: number, extra: number | null, inj1: number): number {
  if (minute <= 45) return minute - 0.5 + (extra ?? 0);
  return 45 + inj1 + HALF_TIME_BREAK + (minute - 46) + 0.5 + (extra ?? 0);
}

export function stateAt(script: DemoScript, now: number): DemoState {
  const t = (now - script.kickoffAt.getTime()) / MINUTE_MS;
  const firstHalfEnd = 45 + script.inj1;
  const secondHalfStart = firstHalfEnd + HALF_TIME_BREAK;
  const end = matchLength(script);
  const lineups = now >= script.kickoffAt.getTime() - LINEUPS_BEFORE_MS ? script.lineups : [];

  if (t < 0) {
    return { ...emptyState(MatchStatus.Scheduled), lineups };
  }

  let status: MatchStatus;
  let minute: number;
  let injuryTime: number | null = null;
  let periodStartedAt: Date | null = null;
  if (t < firstHalfEnd) {
    status = MatchStatus.FirstHalf;
    minute = Math.min(45, Math.floor(t) + 1);
    if (t >= 45) injuryTime = Math.floor(t - 45) + 1;
    periodStartedAt = script.kickoffAt;
  } else if (t < secondHalfStart) {
    status = MatchStatus.HalfTime;
    minute = 45;
  } else if (t < end) {
    const t2 = t - secondHalfStart;
    status = MatchStatus.SecondHalf;
    minute = Math.min(90, 46 + Math.floor(t2));
    if (t2 >= 45) injuryTime = Math.floor(t2 - 45) + 1;
    periodStartedAt = new Date(script.kickoffAt.getTime() + secondHalfStart * MINUTE_MS);
  } else {
    status = MatchStatus.Finished;
    minute = 90;
  }

  const events = script.events.filter((e) => e.at <= t);
  const score = tally(events);
  const firstHalfScore = tally(events.filter((e) => e.minute <= 45));
  const played = status === MatchStatus.Finished ? 90 : Math.min(90, minute);

  return {
    status,
    minute: status === MatchStatus.Finished ? null : minute,
    injuryTime,
    periodStartedAt,
    homeScore: score.home,
    awayScore: score.away,
    htHome: t >= firstHalfEnd ? firstHalfScore.home : null,
    htAway: t >= firstHalfEnd ? firstHalfScore.away : null,
    events,
    stats: statsSoFar(script.finalStats, played / 90, events),
    lineups,
  };
}

function emptyState(status: MatchStatus): DemoState {
  return {
    status,
    minute: null,
    injuryTime: null,
    periodStartedAt: null,
    homeScore: null,
    awayScore: null,
    htHome: null,
    htAway: null,
    events: [],
    stats: [],
    lineups: [],
  };
}

function tally(events: SnapshotEvent[]): { home: number; away: number } {
  let home = 0;
  let away = 0;
  for (const e of events) {
    if (!isGoalEvent(e.type)) continue;
    if (e.side === Side.Home) home++;
    else away++;
  }
  return { home, away };
}

class SideBuilder {
  private readonly squad: DemoPlayer[];
  private readonly formation: string;
  /** name -> [onMinute, offMinute) */
  private readonly onPitchSpan = new Map<string, [number, number]>();
  private readonly subs: { on: string; off: string; minute: number }[] = [];

  constructor(
    private readonly side: Side,
    private readonly teamIndex: number,
    private readonly rand: () => number,
  ) {
    this.squad = demoSquad(teamIndex);
    this.formation = FORMATIONS[teamIndex % FORMATIONS.length]!;
    for (const p of this.squad.slice(0, 11)) this.onPitchSpan.set(p.name, [0, 999]);
  }

  substitutions(): Omit<DemoEvent, 'at' | 'key'>[] {
    const count = 3 + Math.floor(this.rand() * 3);
    const bench = this.squad.slice(12); // keep the reserve goalkeeper on the bench
    const outfield = this.squad.slice(1, 11);
    const out: Omit<DemoEvent, 'at' | 'key'>[] = [];
    for (let i = 0; i < count && bench.length && outfield.length; i++) {
      const minute = this.rand() < 0.2 ? 46 : 55 + Math.floor(this.rand() * 33);
      const off = outfield.splice(Math.floor(this.rand() * outfield.length), 1)[0]!;
      const on = bench.splice(Math.floor(this.rand() * bench.length), 1)[0]!;
      this.onPitchSpan.set(off.name, [0, minute]);
      this.onPitchSpan.set(on.name, [minute, 999]);
      this.subs.push({ on: on.name, off: off.name, minute });
      out.push({
        type: EventType.Substitution,
        side: this.side,
        minute,
        extraMinute: null,
        playerName: on.name,
        assistName: off.name,
        detail: null,
      });
    }
    return out;
  }

  /** A random player on the pitch at `minute`, preferring the given positions. */
  onPitch(
    minute: number,
    prefer: DemoPlayer['position'][],
    rand: () => number,
    exclude?: string | null,
  ): string {
    const playing = this.squad.filter((p) => {
      const span = this.onPitchSpan.get(p.name);
      return (
        span && minute >= span[0] && minute < span[1] && p.name !== exclude && p.position !== 'G'
      );
    });
    const position = pick(rand, prefer);
    const pool = playing.filter((p) => p.position === position);
    return pick(rand, pool.length ? pool : playing).name;
  }

  lineup(): DemoLineup {
    const rows = this.formation.split('-').map(Number);
    const starters = this.squad.slice(0, 11);
    const grid: string[] = ['1:1'];
    rows.forEach((n, r) => {
      for (let c = 1; c <= n; c++) grid.push(`${r + 2}:${c}`);
    });
    const positionFor = (g: string) => {
      const row = Number(g.split(':')[0]);
      if (row === 1) return 'G';
      if (row === 2) return 'D';
      return row === rows.length + 1 ? 'F' : 'M';
    };
    return {
      side: this.side,
      formation: this.formation,
      coachName: DEMO_TEAMS[this.teamIndex]!.coach,
      players: [
        ...starters.map((p, i) => ({
          name: p.name,
          number: p.number,
          position: positionFor(grid[i]!),
          grid: grid[i]!,
          isStarter: true,
        })),
        ...this.squad.slice(11).map((p) => ({
          name: p.name,
          number: p.number,
          position: p.position,
          grid: null,
          isStarter: false,
        })),
      ],
    };
  }
}

function randomMinute(rand: () => number, inj1: number, inj2: number) {
  const roll = rand();
  if (roll < 0.04) return { minute: 45, extraMinute: 1 + Math.floor(rand() * inj1) };
  if (roll < 0.1) return { minute: 90, extraMinute: 1 + Math.floor(rand() * inj2) };
  return { minute: 1 + Math.floor(rand() * 90), extraMinute: null };
}

function poisson(rand: () => number, lambda: number): number {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = rand();
  while (p > limit && k < 9) {
    k++;
    p *= rand();
  }
  return k;
}

function other(side: Side): Side {
  return side === Side.Home ? Side.Away : Side.Home;
}

function finalStats(
  rand: () => number,
  hs: number,
  as: number,
  events: SnapshotEvent[],
): DemoStat[] {
  const goals = tally(events);
  const possession = Math.round(
    Math.min(66, Math.max(34, 50 + (hs - as) * 40 + (rand() - 0.5) * 10)),
  );
  const onTarget = (g: number, s: number) => g + Math.round(s * (1 + rand() * 3));
  const homeOn = onTarget(goals.home, hs);
  const awayOn = onTarget(goals.away, as);
  const shots = (on: number) => on + 3 + Math.floor(rand() * 8);
  return [
    { type: 'possession', home: possession, away: 100 - possession, unit: '%' },
    { type: 'shots', home: shots(homeOn), away: shots(awayOn), unit: null },
    { type: 'shots_on_target', home: homeOn, away: awayOn, unit: null },
    {
      type: 'corners',
      home: 2 + Math.floor(rand() * 7),
      away: 1 + Math.floor(rand() * 6),
      unit: null,
    },
    {
      type: 'fouls',
      home: 7 + Math.floor(rand() * 9),
      away: 8 + Math.floor(rand() * 9),
      unit: null,
    },
    { type: 'offsides', home: Math.floor(rand() * 4), away: Math.floor(rand() * 4), unit: null },
    {
      type: 'saves',
      home: Math.max(0, awayOn - goals.away),
      away: Math.max(0, homeOn - goals.home),
      unit: null,
    },
  ];
}

/** Counting stats grow through the match; cards come from real events. */
function statsSoFar(final: DemoStat[], fraction: number, events: SnapshotEvent[]): DemoStat[] {
  const counted = (side: Side, types: EventType[]) =>
    events.filter((e) => e.side === side && types.includes(e.type)).length;
  const goals = tally(events);
  const stats = final.map((s) => {
    if (s.unit === '%') return s;
    let home = Math.round(s.home * fraction);
    let away = Math.round(s.away * fraction);
    // Never show fewer shots on target than goals already scored.
    if (s.type === 'shots_on_target' || s.type === 'shots') {
      home = Math.max(home, goals.home);
      away = Math.max(away, goals.away);
    }
    return { ...s, home, away };
  });
  stats.push(
    {
      type: 'yellow_cards',
      home: counted(Side.Home, [EventType.YellowCard, EventType.SecondYellow]),
      away: counted(Side.Away, [EventType.YellowCard, EventType.SecondYellow]),
      unit: null,
    },
    {
      type: 'red_cards',
      home: counted(Side.Home, [EventType.RedCard, EventType.SecondYellow]),
      away: counted(Side.Away, [EventType.RedCard, EventType.SecondYellow]),
      unit: null,
    },
  );
  return stats;
}
