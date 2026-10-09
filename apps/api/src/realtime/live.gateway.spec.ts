import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  type ClientToServerEvents,
  MatchStatus,
  type MatchSummary,
  type ServerToClientEvents,
} from '@scoreline/shared';
import { type Socket, io } from 'socket.io-client';
import { FootballQueryService } from '../football/football-query.service.js';
import { ChangeBus, type MatchChangeBatch } from '../ingest/change-bus.js';
import { ScorelineIoAdapter } from './io-adapter.js';
import { LiveGateway } from './live.gateway.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const summary = (over: Partial<MatchSummary> = {}): MatchSummary => ({
  id: 'm1',
  slug: 'arsenal-vs-leeds-united-2026-10-10',
  competition: {
    id: 'c1',
    slug: 'premier-league',
    name: 'Premier League',
    shortName: 'EPL',
    country: 'England',
    emblemUrl: null,
    isDemo: false,
  },
  kickoffAt: '2026-10-10T11:30:00.000Z',
  status: MatchStatus.FirstHalf,
  minute: 23,
  injuryTime: null,
  periodStartedAt: '2026-10-10T11:30:00.000Z',
  home: {
    id: 't1',
    slug: 'arsenal',
    name: 'Arsenal FC',
    shortName: 'Arsenal',
    tla: 'ARS',
    crestUrl: null,
    primaryColor: null,
  },
  away: {
    id: 't2',
    slug: 'leeds-united',
    name: 'Leeds United FC',
    shortName: 'Leeds',
    tla: 'LEE',
    crestUrl: null,
    primaryColor: null,
  },
  score: { home: 1, away: 0 },
  halfTime: { home: null, away: null },
  penalties: null,
  round: 'Matchday 6',
  isDemo: false,
  seq: 3,
  ...over,
});

const batch = (over: Partial<MatchChangeBatch> = {}): MatchChangeBatch => ({
  matchId: 'm1',
  competitionSlug: 'premier-league',
  isDemo: false,
  seq: 3,
  changes: [{ type: 'score', home: 1, away: 0 }],
  summary: summary(),
  ...over,
});

function nextEvent<E extends keyof ServerToClientEvents>(
  client: Client,
  event: E,
  timeoutMs = 3000,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no "${event}" within ${timeoutMs}ms`)),
      timeoutMs,
    );
    client.once(
      event as never,
      ((msg: never) => {
        clearTimeout(timer);
        resolve(msg);
      }) as never,
    );
  });
}

/** Resolves false if the event does NOT arrive in time. */
function noEvent(client: Client, event: keyof ServerToClientEvents, ms = 400): Promise<boolean> {
  return nextEvent(client, event, ms).then(
    () => false,
    () => true,
  );
}

describe('LiveGateway', () => {
  let app: INestApplication;
  let url: string;
  let bus: ChangeBus;
  const clients: Client[] = [];
  const summaries = new Map<string, MatchSummary>([['m1', summary({ seq: 5 })]]);

  beforeAll(async () => {
    process.env.WEB_ORIGIN = 'http://localhost:3001';
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChangeBus,
        LiveGateway,
        {
          provide: FootballQueryService,
          useValue: { summaryById: async (id: string) => summaries.get(id) ?? null },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new ScorelineIoAdapter(app));
    await app.listen(0);
    url = await app.getUrl();
    bus = app.get(ChangeBus);
  });

  afterEach(() => {
    while (clients.length) clients.pop()!.disconnect();
  });

  afterAll(async () => {
    await app.close();
  });

  async function connect(transports: ('websocket' | 'polling')[] = ['websocket']): Promise<Client> {
    const client: Client = io(url, { transports, forceNew: true, reconnection: false });
    clients.push(client);
    await nextEvent(client, 'hello');
    return client;
  }

  it('greets new clients with the server time', async () => {
    const client: Client = io(url, { transports: ['websocket'], forceNew: true });
    clients.push(client);
    const hello = await nextEvent(client, 'hello');
    expect(Math.abs(Date.parse(hello.serverTime) - Date.now())).toBeLessThan(5000);
  });

  it('sends match updates only to rooms that care', async () => {
    const watcher = await connect();
    const other = await connect();
    await watcher.emitWithAck('subscribe', { rooms: ['match:m1'] });
    await other.emitWithAck('subscribe', { rooms: ['match:someone-else'] });

    const received = nextEvent(watcher, 'match:update');
    const otherGotNothing = noEvent(other, 'match:update');
    bus.publish(batch());

    expect(await received).toMatchObject({
      matchId: 'm1',
      seq: 3,
      changes: [{ type: 'score', home: 1 }],
    });
    expect(await otherGotNothing).toBe(true);
  });

  it('routes to competition and live rooms, once per client', async () => {
    const client = await connect();
    await client.emitWithAck('subscribe', {
      rooms: ['live', 'competition:premier-league', 'match:m1'],
    });
    const updates: unknown[] = [];
    client.on('match:update', (m) => updates.push(m));
    bus.publish(batch());
    await new Promise((r) => setTimeout(r, 300));
    expect(updates).toHaveLength(1);
  });

  it('still tells the live room when a match ends', async () => {
    const client = await connect();
    await client.emitWithAck('subscribe', { rooms: ['live'] });
    const received = nextEvent(client, 'match:update');
    bus.publish(
      batch({
        changes: [
          { type: 'status', status: MatchStatus.Finished, previous: MatchStatus.SecondHalf },
        ],
        summary: summary({ status: MatchStatus.Finished }),
      }),
    );
    expect((await received).summary.status).toBe(MatchStatus.Finished);
  });

  it('works over HTTP long-polling when WebSockets are blocked', async () => {
    const client = await connect(['polling']);
    await client.emitWithAck('subscribe', { rooms: ['match:m1'] });
    const received = nextEvent(client, 'match:update');
    bus.publish(batch());
    expect((await received).matchId).toBe('m1');
  });

  it('counts viewers as people join and leave', async () => {
    const a = await connect();
    const b = await connect();
    await a.emitWithAck('subscribe', { rooms: ['match:m1'] });
    const two = nextEvent(a, 'viewers', 3000);
    await b.emitWithAck('subscribe', { rooms: ['match:m1'] });
    expect(await two).toEqual({ matchId: 'm1', count: 2 });

    const one = nextEvent(a, 'viewers', 3000);
    b.disconnect();
    expect(await one).toEqual({ matchId: 'm1', count: 1 });
  });

  it('re-syncs a client that missed updates', async () => {
    const client = await connect();
    const sync = nextEvent(client, 'match:sync');
    await client.emitWithAck('subscribe', { rooms: ['match:m1'], seqs: { m1: 2 } });
    expect(await sync).toMatchObject({ matchId: 'm1', summary: { seq: 5 } });

    const upToDate = await connect();
    const nothing = noEvent(upToDate, 'match:sync');
    await upToDate.emitWithAck('subscribe', { rooms: ['match:m1'], seqs: { m1: 5 } });
    expect(await nothing).toBe(true);
  });

  it('rejects bad room names and too many rooms', async () => {
    const client = await connect();
    const ack = await client.emitWithAck('subscribe', {
      rooms: ['live', 'admin', 'match:../../etc', 42 as never],
    });
    expect(ack).toMatchObject({ ok: true, joined: ['live'] });
    expect(ack.rejected).toHaveLength(3);

    const many = Array.from({ length: 41 }, (_, i) => `match:m${i}`);
    const tooMany = await client.emitWithAck('subscribe', { rooms: many });
    expect(tooMany.joined.length).toBeLessThanOrEqual(40);
  });

  it('slows down clients that flood room requests', async () => {
    const client = await connect();
    let refused = 0;
    for (let i = 0; i < 25; i++) {
      const ack = await client.emitWithAck('subscribe', { rooms: ['live'] });
      if (!ack.ok) refused++;
    }
    expect(refused).toBeGreaterThan(0);
  });

  it('lets clients leave rooms', async () => {
    const client = await connect();
    await client.emitWithAck('subscribe', { rooms: ['match:m1'] });
    await client.emitWithAck('unsubscribe', { rooms: ['match:m1'] });
    const quiet = noEvent(client, 'match:update');
    bus.publish(batch());
    expect(await quiet).toBe(true);
  });
});
