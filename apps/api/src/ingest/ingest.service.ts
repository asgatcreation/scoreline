import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { MatchStatus, addDays } from '@scoreline/shared';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { PrismaService } from '../database/prisma.service.js';
import { TRACKED_COMPETITIONS } from '../football/competitions.js';
import { ApiFootballProvider } from '../providers/api-football/api-football.provider.js';
import { FootballDataProvider } from '../providers/football-data/football-data.provider.js';
import { ProviderError } from '../providers/provider-http.js';
import type { LiveSource, ProviderName, SeasonSource } from '../providers/types.js';
import { matchWindows, nextUtcMidnight, planLivePolling } from './polling-plan.js';
import { SyncService } from './sync.service.js';
import { PrismaUsageStore } from './usage-store.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const TICK_MS = 30_000;
/** Competitions important enough to spend detail requests on. */
const DETAIL_PRIORITY = 10;
/** Match-detail requests per day (line-ups and stats). */
const DETAIL_BUDGET = 25;
/** Fixture-by-date sweeps kept in reserve each day. */
const DATE_SWEEP_RESERVE = 8;
/** A job that hangs (e.g. on a dead connection) must not freeze the worker. */
const JOB_TIMEOUT_MS = 20 * MINUTE;

interface Job {
  name: string;
  provider: ProviderName;
  /** Next time it should run; overdue jobs run on the next tick. */
  due: number;
  run: () => Promise<{ requests: number; changes: number; next: number }>;
}

/**
 * The background worker. One tick every 30 seconds runs whichever jobs are
 * due, one at a time. Last successful runs are read from IngestRun at
 * start-up, so after a restart or Render sleep anything overdue runs first
 * (that is the catch-up).
 */
@Injectable()
export class IngestService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(IngestService.name);
  private readonly live?: LiveSource;
  private readonly season?: SeasonSource;
  private readonly apiFootball?: ApiFootballProvider;
  private readonly footballData?: FootballDataProvider;
  private readonly jobs: Job[] = [];
  private timer?: NodeJS.Timeout;
  private running = false;
  private detailsUsed = { day: '', count: 0 };

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
    usage: PrismaUsageStore,
  ) {
    if (config.apiFootballKey) {
      this.apiFootball = new ApiFootballProvider(
        config.apiFootballKey,
        config.apiFootballDailyLimit,
        usage,
      );
    }
    if (config.footballDataToken) {
      this.footballData = new FootballDataProvider(
        config.footballDataToken,
        config.footballDataMinuteLimit,
        usage,
      );
    }
    // API-Football is the fast feed when available; football-data.org can stand in.
    this.live = this.apiFootball ?? this.footballData;
    this.season = this.footballData;
  }

  /** Request budgets, for the status endpoint. */
  quotas() {
    return [this.apiFootball, this.footballData].flatMap((p) =>
      p ? [p.http.quota.snapshot()] : [],
    );
  }

  get liveProvider(): ProviderName | null {
    return this.live?.name ?? null;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.ingestEnabled) {
      this.logger.log('Ingest disabled');
      return;
    }
    if (!this.live && !this.season) {
      this.logger.warn('No provider keys set: only demo matches will be shown');
      return;
    }
    // Start in the background so the API answers /healthz straight away.
    void this.start().catch((err: Error) =>
      this.logger.error(`Ingest failed to start: ${err.message}`),
    );
  }

  onModuleDestroy(): void {
    clearTimeout(this.timer);
  }

  private async start(): Promise<void> {
    await this.sync.ensureCompetitions();
    // Runs cut short by a restart or sleep never finished; say so.
    await this.prisma.ingestRun.updateMany({
      where: { finishedAt: null },
      data: { finishedAt: new Date(), error: 'interrupted (server restarted)' },
    });
    const last = await this.lastSuccessfulRuns();
    const dueAfter = (name: string, every: number) => (last.get(name) ?? 0) + every;

    if (this.season) {
      this.addJob('season-full', this.season.name, dueAfter('season-full', 12 * HOUR), () =>
        this.seasonFull(),
      );
      this.addJob('season-recent', this.season.name, dueAfter('season-recent', HOUR), () =>
        this.seasonRecent(),
      );
    }
    if (this.live) {
      this.addJob('dates', this.live.name, dueAfter('dates', 4 * HOUR), () => this.dates());
      this.addJob('live', this.live.name, Date.now(), () => this.livePoll());
    }
    this.addJob(
      'cleanup',
      this.season?.name ?? this.live!.name,
      dueAfter('cleanup', 24 * HOUR),
      () => this.cleanup(),
    );

    const overdue = this.jobs.filter((j) => j.due <= Date.now()).map((j) => j.name);
    this.logger.log(
      `Ingest started (live: ${this.live?.name ?? 'none'}, season: ${this.season?.name ?? 'none'}); catching up: ${overdue.join(', ') || 'nothing'}`,
    );
    this.schedule(0);
  }

  private addJob(name: string, provider: ProviderName, due: number, run: Job['run']) {
    this.jobs.push({ name, provider, due, run });
  }

  private schedule(delay = TICK_MS) {
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const job of this.jobs.sort((a, b) => a.due - b.due)) {
        if (job.due > Date.now()) break;
        await this.runJob(job);
      }
    } finally {
      this.running = false;
      this.schedule();
    }
  }

  private async runJob(job: Job): Promise<void> {
    const started = Date.now();
    let run: { id: string } | undefined;
    try {
      run = await this.prisma.ingestRun.create({ data: { provider: job.provider, job: job.name } });
      const result = await withTimeout(
        job.run(),
        JOB_TIMEOUT_MS,
        `${job.name} took over 20 minutes`,
      );
      job.due = result.next;
      await this.prisma.ingestRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          ok: true,
          requests: result.requests,
          changes: result.changes,
        },
      });
      this.logger.log(
        `${job.name}: ${result.requests} requests, ${result.changes} changes in ${Date.now() - started}ms; next in ${Math.round((result.next - Date.now()) / 1000)}s`,
      );
    } catch (err) {
      const wait = err instanceof ProviderError && err.retryAfterMs ? err.retryAfterMs : 5 * MINUTE;
      job.due = Date.now() + Math.max(wait, MINUTE);
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `${job.name} failed: ${message}; retry in ${Math.round((job.due - Date.now()) / 1000)}s`,
      );
      if (run) {
        await this.prisma.ingestRun
          .update({
            where: { id: run.id },
            data: { finishedAt: new Date(), error: message.slice(0, 500) },
          })
          .catch(() => undefined);
      }
    }
  }

  private async lastSuccessfulRuns(): Promise<Map<string, number>> {
    const rows = await this.prisma.ingestRun.groupBy({
      by: ['job'],
      where: { ok: true },
      _max: { startedAt: true },
    });
    return new Map(rows.map((r) => [r.job, r._max.startedAt?.getTime() ?? 0]));
  }

  // ---------------------------------------------------------------------
  // Jobs
  // ---------------------------------------------------------------------

  /** Whole-season fixtures, tables and scorers for every season competition. */
  private async seasonFull() {
    const season = this.season!;
    let requests = 0;
    let changes = 0;
    for (const slug of season.competitions()) {
      await this.forEachCompetition(slug, async () => {
        const matches = await season.getMatches(slug);
        requests++;
        changes += (await this.sync.syncMatches(season.name, 'season', matches)).changes;
        changes += await this.standingsAndScorers(slug);
        requests += 2;
      });
    }
    return { requests, changes, next: Date.now() + 12 * HOUR };
  }

  /**
   * One competition failing must not stop the others. Rate limits and
   * quota still abort the whole job, so it backs off as a unit.
   */
  private async forEachCompetition(slug: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (err) {
      if (err instanceof ProviderError && (err.kind === 'rate-limit' || err.kind === 'quota')) {
        throw err;
      }
      this.logger.warn(`Skipped ${slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** The last few days and the next week, refreshed hourly (more often on match days). */
  private async seasonRecent() {
    const season = this.season!;
    const today = new Date().toISOString().slice(0, 10);
    const busy = await this.competitionsPlayingToday();
    let requests = 0;
    let changes = 0;
    for (const slug of season.competitions()) {
      await this.forEachCompetition(slug, async () => {
        const matches = await season.getMatches(slug, addDays(today, -3), addDays(today, 7));
        requests++;
        changes += (await this.sync.syncMatches(season.name, 'season', matches)).changes;
        if (busy.has(slug)) {
          changes += await this.standingsAndScorers(slug);
          requests += 2;
        }
      });
    }
    // On match days refresh every 15 minutes so tables update soon after full time.
    return { requests, changes, next: Date.now() + (busy.size ? 15 * MINUTE : HOUR) };
  }

  private async standingsAndScorers(slug: string): Promise<number> {
    const season = this.season!;
    let rows = 0;
    const table = await season.getStandings(slug);
    if (table?.rows.length) rows += await this.sync.saveStandings(season.name, table);
    const scorers = await season.getScorers(slug);
    if (scorers?.scorers.length) rows += await this.sync.saveScorers(season.name, slug, scorers);
    return rows ? 1 : 0;
  }

  /** Yesterday, today and tomorrow from the live feed (UTC days). */
  private async dates() {
    const live = this.live!;
    const today = new Date().toISOString().slice(0, 10);
    let changes = 0;
    for (const date of [today, addDays(today, 1), addDays(today, -1)]) {
      changes += (await this.sync.syncMatches(live.name, 'live', await live.getByDate(date)))
        .changes;
    }
    return { requests: 3, changes, next: Date.now() + 4 * HOUR };
  }

  /** Live scores, at a pace the daily budget can afford. */
  private async livePoll() {
    const live = this.live!;
    const now = Date.now();
    const windows = matchWindows(await this.trackedKickoffs(now));
    const quota = (live === this.apiFootball ? this.apiFootball : this.footballData)!.http.quota;
    const plan = planLivePolling({
      windows,
      now,
      dayEnd: nextUtcMidnight(now),
      remaining: quota.remainingToday(now),
      reserved: DATE_SWEEP_RESERVE + this.detailsLeftToday(),
      minIntervalMs: live === this.footballData ? 2 * MINUTE : MINUTE,
    });
    if (plan.action === 'wait') return { requests: 0, changes: 0, next: now + plan.nextInMs };

    const matches = await live.getLive();
    const result = await this.sync.syncMatches(live.name, 'live', matches);
    const finished = await this.markVanishedAsFinishedCandidates(matches.map((m) => m.externalId));
    const details = await this.fetchDetails();
    return { requests: 1 + finished + details, changes: result.changes, next: now + plan.nextInMs };
  }

  /**
   * A match that was live but has left the live feed has usually just
   * ended. Fetch it once by id so its final score lands promptly.
   */
  private async markVanishedAsFinishedCandidates(stillLive: string[]): Promise<number> {
    const live = this.live!;
    const recentlyLive = await this.prisma.match.findMany({
      where: {
        status: {
          in: [
            MatchStatus.FirstHalf,
            MatchStatus.HalfTime,
            MatchStatus.SecondHalf,
            MatchStatus.ExtraTime,
            MatchStatus.BreakExtraTime,
            MatchStatus.Penalties,
          ],
        },
        kickoffAt: { gte: new Date(Date.now() - 4 * HOUR) },
        isDemo: false,
      },
      select: { id: true },
    });
    if (recentlyLive.length === 0) return 0;
    const refs = await this.prisma.externalRef.findMany({
      where: {
        provider: live.name,
        entityType: 'MATCH',
        internalId: { in: recentlyLive.map((m) => m.id) },
      },
    });
    let requests = 0;
    for (const ref of refs.filter((r) => !stillLive.includes(r.externalId)).slice(0, 5)) {
      const details = await live.getDetails(ref.externalId);
      requests++;
      if (details) await this.sync.saveDetails(live.name, details);
    }
    return requests;
  }

  /**
   * Line-ups and stats for the biggest matches: once after kick-off and
   * once after full time, within a daily budget.
   */
  private async fetchDetails(): Promise<number> {
    const live = this.live!;
    if (live !== this.apiFootball) return 0; // football-data.org free has no details
    let left = this.detailsLeftToday();
    if (left <= 0) return 0;
    const candidates = await this.prisma.match.findMany({
      where: {
        isDemo: false,
        competition: { priority: { lte: DETAIL_PRIORITY } },
        kickoffAt: { gte: new Date(Date.now() - 6 * HOUR), lte: new Date() },
        OR: [
          { detailsSyncedAt: null, status: { not: MatchStatus.Scheduled } },
          {
            status: MatchStatus.Finished,
            finalizedAt: { not: null },
            detailsSyncedAt: { lt: new Date(Date.now() - 10 * MINUTE) },
          },
        ],
      },
      orderBy: { competition: { priority: 'asc' } },
      select: { id: true, finalizedAt: true, detailsSyncedAt: true },
      take: 10,
    });
    let requests = 0;
    for (const m of candidates) {
      if (left <= 0) break;
      // After full time we need exactly one more fetch.
      if (m.finalizedAt && m.detailsSyncedAt && m.detailsSyncedAt > m.finalizedAt) continue;
      const ref = await this.prisma.externalRef.findFirst({
        where: { provider: live.name, entityType: 'MATCH', internalId: m.id },
      });
      if (!ref) continue;
      const details = await live.getDetails(ref.externalId);
      requests++;
      left--;
      this.useDetail();
      if (details) await this.sync.saveDetails(live.name, details);
    }
    return requests;
  }

  private detailsLeftToday(): number {
    const day = new Date().toISOString().slice(0, 10);
    if (this.detailsUsed.day !== day) this.detailsUsed = { day, count: 0 };
    return Math.max(0, DETAIL_BUDGET - this.detailsUsed.count);
  }

  private useDetail() {
    this.detailsLeftToday();
    this.detailsUsed.count++;
  }

  private async cleanup() {
    const { count } = await this.prisma.ingestRun.deleteMany({
      where: { startedAt: { lt: new Date(Date.now() - 14 * 24 * HOUR) } },
    });
    return { requests: 0, changes: count, next: Date.now() + 24 * HOUR };
  }

  private async trackedKickoffs(now: number): Promise<number[]> {
    const rows = await this.prisma.match.findMany({
      where: {
        isDemo: false,
        kickoffAt: { gte: new Date(now - 3 * HOUR), lt: new Date(nextUtcMidnight(now)) },
        status: {
          notIn: [
            MatchStatus.Finished,
            MatchStatus.Postponed,
            MatchStatus.Cancelled,
            MatchStatus.Abandoned,
          ],
        },
      },
      select: { kickoffAt: true },
    });
    return rows.map((r) => r.kickoffAt.getTime());
  }

  private async competitionsPlayingToday(): Promise<Set<string>> {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const rows = await this.prisma.match.findMany({
      where: {
        kickoffAt: { gte: start, lt: new Date(start.getTime() + 24 * HOUR) },
        isDemo: false,
      },
      select: { competition: { select: { slug: true } } },
      distinct: ['competitionId'],
    });
    const slugs = new Set(rows.map((r) => r.competition.slug));
    return new Set(TRACKED_COMPETITIONS.filter((c) => slugs.has(c.slug)).map((c) => c.slug));
  }
}

/** Rejects if `work` hasn't settled in time, so the next tick can run. */
export function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
