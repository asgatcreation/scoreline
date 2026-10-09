import { EventEmitter } from 'node:events';
import type { MatchSummary } from '@scoreline/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ConnectionState, LiveClient } from './live-client';

/** Just enough of a Socket.IO socket to drive the client in tests. */
class FakeSocket extends EventEmitter {
  connected = false;
  sent: { event: string; payload: unknown }[] = [];

  override emit(event: string, ...args: unknown[]): boolean {
    if (
      [
        'connect',
        'disconnect',
        'connect_error',
        'hello',
        'match:update',
        'match:sync',
        'viewers',
      ].includes(event)
    ) {
      return super.emit(event, ...args);
    }
    this.sent.push({ event, payload: args[0] });
    return true;
  }

  serverConnects() {
    this.connected = true;
    this.emit('connect');
  }

  serverDrops() {
    this.connected = false;
    this.emit('disconnect', 'transport close');
  }

  connect() {
    return this;
  }

  disconnect() {
    this.connected = false;
    return this;
  }
}

function setup(poll = vi.fn()) {
  const socket = new FakeSocket();
  const client = new LiveClient({
    url: 'http://api.test',
    poll,
    fallbackAfterMs: 10_000,
    pollEveryMs: 30_000,
    createSocket: () => socket as never,
  });
  const states: ConnectionState[] = [];
  client.onState((s) => states.push(s));
  return { socket, client, states, poll };
}

describe('LiveClient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('goes live and joins the rooms asked for before connecting', () => {
    const { socket, client, states } = setup();
    client.subscribe(['live', 'match:m1']);
    socket.serverConnects();
    expect(states).toEqual(['live']);
    expect(socket.sent).toEqual([
      { event: 'subscribe', payload: { rooms: ['live', 'match:m1'], seqs: {} } },
    ]);
  });

  it('rejoins its rooms with the last seq it saw after a reconnect', () => {
    const { socket, client, states } = setup();
    socket.serverConnects();
    client.subscribe(['match:m1']);
    socket.emit('match:update', {
      matchId: 'm1',
      seq: 7,
      changes: [],
      summary: {} as MatchSummary,
    });

    socket.serverDrops();
    socket.sent = [];
    socket.serverConnects();

    expect(states).toEqual(['live', 'reconnecting', 'live']);
    expect(socket.sent[0]).toEqual({
      event: 'subscribe',
      payload: { rooms: ['match:m1'], seqs: { m1: 7 } },
    });
  });

  it('falls back to polling when it cannot connect, and stops once connected', async () => {
    const { socket, states, poll } = setup();
    vi.advanceTimersByTime(10_000);
    expect(states).toEqual(['polling']);
    expect(poll).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(poll).toHaveBeenCalledTimes(3);

    socket.serverConnects();
    vi.advanceTimersByTime(60_000);
    expect(poll).toHaveBeenCalledTimes(3);
    expect(states.at(-1)).toBe('live');
  });

  it('does not poll after a brief drop that recovers quickly', () => {
    const { socket, poll } = setup();
    socket.serverConnects();
    socket.serverDrops();
    vi.advanceTimersByTime(5_000);
    socket.serverConnects();
    vi.advanceTimersByTime(30_000);
    expect(poll).not.toHaveBeenCalled();
  });

  it('passes updates, syncs and viewer counts to listeners', () => {
    const { socket, client } = setup();
    const updates = vi.fn();
    const syncs = vi.fn();
    const viewers = vi.fn();
    client.onUpdate(updates);
    client.onSync(syncs);
    const stop = client.onViewers(viewers);

    socket.emit('match:update', { matchId: 'm1', seq: 2, changes: [], summary: {} });
    socket.emit('match:sync', { matchId: 'm1', summary: { seq: 4 } });
    socket.emit('viewers', { matchId: 'm1', count: 12 });
    stop();
    socket.emit('viewers', { matchId: 'm1', count: 13 });

    expect(updates).toHaveBeenCalledTimes(1);
    expect(syncs).toHaveBeenCalledTimes(1);
    expect(viewers).toHaveBeenCalledExactlyOnceWith({ matchId: 'm1', count: 12 });
  });

  it('measures the clock difference to the server', () => {
    const { socket, client } = setup();
    socket.emit('hello', { serverTime: new Date(Date.now() + 4_000).toISOString() });
    expect(client.clockOffsetMs).toBeGreaterThanOrEqual(3_990);
  });

  it('leaves rooms and stops everything on close', () => {
    const { socket, client, poll } = setup();
    socket.serverConnects();
    const leave = client.subscribe(['match:m1']);
    leave();
    expect(socket.sent.at(-1)).toEqual({ event: 'unsubscribe', payload: { rooms: ['match:m1'] } });
    client.close();
    vi.advanceTimersByTime(120_000);
    expect(poll).not.toHaveBeenCalled();
  });
});
