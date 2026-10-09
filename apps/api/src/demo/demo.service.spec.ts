import { MatchStatus } from '@scoreline/shared';
import type { AppConfig } from '../config.js';
import { ChangeBus, type MatchChangeBatch } from '../ingest/change-bus.js';
import { SLOT_MS, scriptFor } from './demo-engine.js';
import { DemoService } from './demo.service.js';

const MIN = 60_000;
const config = { demoEnabled: true, nodeEnv: 'test' } as AppConfig;

describe('DemoService', () => {
  const slot = 740_000;
  const ko = slot * SLOT_MS;

  function setup() {
    const bus = new ChangeBus();
    const published: MatchChangeBatch[] = [];
    bus.changes$.subscribe((b) => published.push(b));
    return { demo: new DemoService(config, bus), published };
  }

  it('announces kick-off as a status change', () => {
    const { demo, published } = setup();
    demo.tick(ko - 1000);
    demo.tick(ko + 1000);
    const kickoff = published.find((b) => b.matchId === `demo-${slot}`)!;
    expect(kickoff.isDemo).toBe(true);
    expect(kickoff.changes).toContainEqual({
      type: 'status',
      status: MatchStatus.FirstHalf,
      previous: MatchStatus.Scheduled,
    });
    expect(kickoff.summary.competition.slug).toBe('scoreline-demo-league');
  });

  it('stays quiet on its first look after start-up', () => {
    const { demo, published } = setup();
    demo.tick(ko + 30 * MIN);
    expect(published).toHaveLength(0);
  });

  it('publishes each goal once, with a growing seq', () => {
    const { demo, published } = setup();
    const script = scriptFor(slot);
    for (let t = ko - MIN; t < ko + 130 * MIN; t += 20_000) demo.tick(t);
    const mine = published.filter((b) => b.matchId === script.id);
    const goals = mine.flatMap((b) => b.changes).filter((c) => c.type === 'score');
    const final = mine.at(-1)!.summary;
    expect(final.status).toBe(MatchStatus.Finished);
    // One score change at kick-off (none -> 0-0), then one per goal.
    expect(goals.length).toBe(1 + (final.score.home ?? 0) + (final.score.away ?? 0));
    const seqs = mine.map((b) => b.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  it('finds matches by id or slug, with details', () => {
    const { demo } = setup();
    const script = scriptFor(slot);
    const now = ko + 100 * MIN;
    const byId = demo.find(script.id, now)!;
    const bySlug = demo.find(script.slug, now)!;
    expect(bySlug.id).toBe(byId.id);
    expect(byId.lineups).toHaveLength(2);
    expect(byId.venue?.name).toBeTruthy();
    expect(demo.find('demo-not-a-match', now)).toBeNull();
    expect(demo.find('arsenal-vs-leeds-2026-10-10', now)).toBeNull();
  });

  it('builds a sensible league table', () => {
    const { demo } = setup();
    const table = demo.standings(ko);
    expect(table).toHaveLength(10);
    expect(table[0]!.position).toBe(1);
    const totalWins = table.reduce((n, r) => n + r.won, 0);
    const totalLosses = table.reduce((n, r) => n + r.lost, 0);
    expect(totalWins).toBe(totalLosses);
    for (let i = 1; i < table.length; i++) {
      expect(table[i - 1]!.points).toBeGreaterThanOrEqual(table[i]!.points);
    }
  });
});
