import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  type CompetitionRef,
  type MatchDetail,
  MatchStatus,
  type MatchSummary,
  type StandingRow,
  type TeamRef,
  isEnded,
} from '@scoreline/shared';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { DEMO_COMPETITION } from '../football/competitions.js';
import { ChangeBus } from '../ingest/change-bus.js';
import { type MatchSnapshot, diffMatch } from '../ingest/match-diff.js';
import {
  type DemoScript,
  type DemoState,
  SLOT_MS,
  matchLength,
  scriptFor,
  slotsBetween,
  stateAt,
} from './demo-engine.js';
import { DEMO_TEAMS } from './demo-teams.js';

const MINUTE = 60_000;
const PHASE: Record<MatchStatus, number> = {
  SCHEDULED: 0,
  FIRST_HALF: 1,
  HALF_TIME: 2,
  SECOND_HALF: 3,
  EXTRA_TIME: 3,
  BREAK_EXTRA_TIME: 3,
  PENALTIES: 3,
  FINISHED: 4,
  POSTPONED: 0,
  SUSPENDED: 0,
  CANCELLED: 0,
  ABANDONED: 0,
};

export const DEMO_COMPETITION_REF: CompetitionRef = {
  id: 'demo',
  slug: DEMO_COMPETITION.slug,
  name: DEMO_COMPETITION.name,
  shortName: DEMO_COMPETITION.shortName,
  country: null,
  emblemUrl: null,
  isDemo: true,
};

/**
 * Serves demo matches straight from the deterministic engine (no database)
 * and publishes their changes every second, exactly like real matches.
 */
@Injectable()
export class DemoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DemoService.name);
  private timer?: NodeJS.Timeout;
  private readonly seen = new Map<number, DemoState>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly bus: ChangeBus,
  ) {}

  get enabled(): boolean {
    return this.config.demoEnabled;
  }

  onModuleInit(): void {
    if (!this.enabled || this.config.nodeEnv === 'test') return;
    this.tick();
    this.timer = setInterval(() => this.tick(), 1000);
    this.logger.log('Demo matches running');
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Publishes whatever changed in demo matches since the last tick. */
  tick(now = Date.now()): void {
    const slots = slotsBetween(now - 130 * MINUTE, now + MINUTE);
    for (const slot of slots) {
      const script = scriptFor(slot);
      const state = stateAt(script, now);
      const prev = this.seen.get(slot);
      this.seen.set(slot, state);
      if (!prev) continue; // first look after start-up: nothing to announce
      const changes = diffMatch(
        snapshot(script, prev),
        snapshot(script, state),
        prev.events,
        state.events,
      );
      if (changes.length === 0) continue;
      this.bus.publish({
        matchId: script.id,
        competitionSlug: DEMO_COMPETITION.slug,
        isDemo: true,
        seq: demoSeq(state),
        changes,
        summary: this.toSummary(script, state),
      });
    }
    for (const slot of this.seen.keys()) if (!slots.includes(slot)) this.seen.delete(slot);
  }

  teams(): TeamRef[] {
    return DEMO_TEAMS.map((t) => ({
      id: t.slug,
      slug: t.slug,
      name: t.name,
      shortName: t.shortName,
      tla: t.tla,
      crestUrl: null,
      primaryColor: t.primaryColor,
    }));
  }

  /** Demo matches kicking off in [from, to). */
  matchesBetween(from: number, to: number, now = Date.now()): MatchSummary[] {
    return slotsBetween(from, to).map((slot) => {
      const script = scriptFor(slot);
      return this.toSummary(script, stateAt(script, now));
    });
  }

  live(now = Date.now()): MatchSummary[] {
    return this.matchesBetween(now - 130 * MINUTE, now + 1, now).filter(
      (m) => m.status !== MatchStatus.Scheduled && !isEnded(m.status),
    );
  }

  /** Accepts "demo-<slot>" ids and slugs ending in "-<slot>". */
  find(idOrSlug: string, now = Date.now()): MatchDetail | null {
    const m = idOrSlug.match(/^demo-(?:.*-)?(\d+)$/);
    if (!m) return null;
    const slot = Number(m[1]);
    // Only a week either side of now exists.
    if (Math.abs(slot * SLOT_MS - now) > 7 * 24 * 60 * MINUTE) return null;
    const script = scriptFor(slot);
    if (idOrSlug !== script.id && idOrSlug !== script.slug) return null;
    return this.toDetail(script, stateAt(script, now), now);
  }

  /** League table from the last seven days of demo results. */
  standings(now = Date.now()): StandingRow[] {
    const rows = new Map<number, StandingRow & { results: string[] }>();
    const teams = this.teams();
    DEMO_TEAMS.forEach((_, i) =>
      rows.set(i, {
        position: 0,
        team: teams[i]!,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDiff: 0,
        points: 0,
        form: null,
        zone: null,
        results: [],
      }),
    );
    for (const slot of slotsBetween(now - 7 * 24 * 60 * MINUTE, now)) {
      const script = scriptFor(slot);
      const st = stateAt(script, now);
      if (st.status !== MatchStatus.Finished) continue;
      const h = rows.get(script.homeIndex)!;
      const a = rows.get(script.awayIndex)!;
      record(h, st.homeScore!, st.awayScore!);
      record(a, st.awayScore!, st.homeScore!);
    }
    const sorted = [...rows.values()].sort(
      (x, y) =>
        y.points - x.points ||
        y.goalDiff - x.goalDiff ||
        y.goalsFor - x.goalsFor ||
        x.team.name.localeCompare(y.team.name),
    );
    return sorted.map(({ results, ...row }, i) => ({
      ...row,
      position: i + 1,
      form: results.slice(-5).join(''),
      zone: i === 0 ? 'champions' : i >= sorted.length - 2 ? 'relegation' : null,
    }));
  }

  private toSummary(script: DemoScript, state: DemoState): MatchSummary {
    const teams = this.teams();
    return {
      id: script.id,
      slug: script.slug,
      competition: DEMO_COMPETITION_REF,
      kickoffAt: script.kickoffAt.toISOString(),
      status: state.status,
      minute: state.minute,
      injuryTime: state.injuryTime,
      periodStartedAt: state.periodStartedAt?.toISOString() ?? null,
      home: teams[script.homeIndex]!,
      away: teams[script.awayIndex]!,
      score: { home: state.homeScore, away: state.awayScore },
      halfTime: { home: state.htHome, away: state.htAway },
      penalties: null,
      round: 'Demo',
      isDemo: true,
      seq: demoSeq(state),
    };
  }

  private toDetail(script: DemoScript, state: DemoState, now: number): MatchDetail {
    const home = DEMO_TEAMS[script.homeIndex]!;
    return {
      ...this.toSummary(script, state),
      venue: { name: home.stadium, city: home.city },
      referee: script.referee,
      attendance: null,
      events: state.events.map((e) => ({
        id: `${script.id}:${e.key}`,
        type: e.type,
        side: e.side,
        minute: e.minute,
        extraMinute: e.extraMinute,
        playerName: e.playerName,
        assistName: e.assistName,
        detail: e.detail,
      })),
      lineups: state.lineups,
      stats: state.stats.map((s) => ({ type: s.type, home: s.home, away: s.away, unit: s.unit })),
      headToHead: this.headToHead(script, now),
    };
  }

  private headToHead(script: DemoScript, now: number): MatchSummary[] {
    const out: MatchSummary[] = [];
    for (let k = script.slot - 1; k > script.slot - 600 && out.length < 5; k--) {
      const s = scriptFor(k);
      const same =
        (s.homeIndex === script.homeIndex && s.awayIndex === script.awayIndex) ||
        (s.homeIndex === script.awayIndex && s.awayIndex === script.homeIndex);
      if (!same) continue;
      const st = stateAt(s, now);
      if (st.status === MatchStatus.Finished) out.push(this.toSummary(s, st));
    }
    return out;
  }
}

function snapshot(script: DemoScript, s: DemoState): MatchSnapshot {
  return {
    status: s.status,
    kickoffAt: script.kickoffAt,
    minute: s.minute,
    injuryTime: s.injuryTime,
    homeScore: s.homeScore,
    awayScore: s.awayScore,
    htHome: s.htHome,
    htAway: s.htAway,
    penHome: null,
    penAway: null,
  };
}

/** Grows with every visible change, so clients can order updates. */
function demoSeq(s: DemoState): number {
  return PHASE[s.status] * 1000 + s.events.length;
}

function record(row: StandingRow & { results: string[] }, scored: number, conceded: number) {
  row.played++;
  row.goalsFor += scored;
  row.goalsAgainst += conceded;
  row.goalDiff = row.goalsFor - row.goalsAgainst;
  if (scored > conceded) {
    row.won++;
    row.points += 3;
    row.results.push('W');
  } else if (scored === conceded) {
    row.drawn++;
    row.points += 1;
    row.results.push('D');
  } else {
    row.lost++;
    row.results.push('L');
  }
}

export { matchLength };
