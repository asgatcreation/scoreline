import type {
  ClientToServerEvents,
  MatchSyncMessage,
  MatchUpdateMessage,
  RoomName,
  ServerToClientEvents,
  ViewersMessage,
} from '@scoreline/shared';
import { type Socket, io } from 'socket.io-client';

/**
 * What the "Live" badge shows:
 * - connecting:   first attempt
 * - live:         real-time updates are flowing
 * - reconnecting: lost the connection, retrying with backoff
 * - polling:      real-time is unavailable; refreshing over HTTP instead
 * - offline:      the browser itself is offline
 */
export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'polling' | 'offline';

type LiveSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface LiveClientOptions {
  url: string;
  /** Called instead of real-time updates while in polling mode. */
  poll?: () => void | Promise<void>;
  /** Switch to polling if not connected within this long (ms). */
  fallbackAfterMs?: number;
  /** How often to poll in polling mode (ms). */
  pollEveryMs?: number;
  /** For tests: build the socket yourself. */
  createSocket?: (url: string) => LiveSocket;
}

type Listener<T> = (value: T) => void;

/**
 * One real-time connection per page. Pages say which rooms they want; the
 * client keeps them joined across reconnects and catches up on anything
 * missed. If real-time can't connect at all it falls back to polling.
 */
export class LiveClient {
  private readonly socket: LiveSocket;
  private readonly rooms = new Set<RoomName>();
  private readonly seqs = new Map<string, number>();
  private readonly listeners = {
    state: new Set<Listener<ConnectionState>>(),
    update: new Set<Listener<MatchUpdateMessage>>(),
    sync: new Set<Listener<MatchSyncMessage>>(),
    viewers: new Set<Listener<ViewersMessage>>(),
  };
  private stateValue: ConnectionState = 'connecting';
  private fallbackTimer?: ReturnType<typeof setTimeout>;
  private pollTimer?: ReturnType<typeof setInterval>;
  /** serverTime - localTime, so match clocks agree with the server. */
  clockOffsetMs = 0;

  constructor(private readonly opts: LiveClientOptions) {
    this.socket =
      opts.createSocket?.(opts.url) ??
      io(opts.url, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1_000,
        reconnectionDelayMax: 30_000,
        randomizationFactor: 0.5,
        timeout: 10_000,
      });

    this.socket.on('connect', () => this.onConnect());
    this.socket.on('disconnect', () => {
      this.setState('reconnecting');
      this.armFallback();
    });
    this.socket.on('connect_error', () => {
      if (this.stateValue !== 'polling') this.setState('reconnecting');
    });
    this.socket.on('hello', (msg) => {
      this.clockOffsetMs = Date.parse(msg.serverTime) - Date.now();
    });
    this.socket.on('match:update', (msg) => {
      this.seqs.set(msg.matchId, msg.seq);
      for (const l of this.listeners.update) l(msg);
    });
    this.socket.on('match:sync', (msg) => {
      this.seqs.set(msg.matchId, msg.summary.seq);
      for (const l of this.listeners.sync) l(msg);
    });
    this.socket.on('viewers', (msg) => {
      for (const l of this.listeners.viewers) l(msg);
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
    this.armFallback();
  }

  get state(): ConnectionState {
    return this.stateValue;
  }

  /** Join rooms; they stay joined across reconnects. */
  subscribe(rooms: RoomName[], seqs: Record<string, number> = {}): () => void {
    for (const [id, seq] of Object.entries(seqs)) this.seqs.set(id, seq);
    const fresh = rooms.filter((r) => !this.rooms.has(r));
    for (const r of fresh) this.rooms.add(r);
    if (fresh.length && this.socket.connected) this.join(fresh);
    return () => this.unsubscribe(fresh);
  }

  unsubscribe(rooms: RoomName[]): void {
    const leaving = rooms.filter((r) => this.rooms.delete(r));
    if (leaving.length && this.socket.connected)
      this.socket.emit('unsubscribe', { rooms: leaving });
  }

  /** Remember the latest seq we have for a match (e.g. from a REST load). */
  noteSeq(matchId: string, seq: number): void {
    if ((this.seqs.get(matchId) ?? -1) < seq) this.seqs.set(matchId, seq);
  }

  onState(l: Listener<ConnectionState>) {
    return this.add('state', l);
  }
  onUpdate(l: Listener<MatchUpdateMessage>) {
    return this.add('update', l);
  }
  onSync(l: Listener<MatchSyncMessage>) {
    return this.add('sync', l);
  }
  onViewers(l: Listener<ViewersMessage>) {
    return this.add('viewers', l);
  }

  close(): void {
    clearTimeout(this.fallbackTimer);
    clearInterval(this.pollTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    this.socket.disconnect();
  }

  private onConnect(): void {
    clearTimeout(this.fallbackTimer);
    this.stopPolling();
    this.setState('live');
    // Recovered sessions keep their rooms; joining again is harmless and
    // also covers longer outages where the server forgot us.
    if (this.rooms.size) this.join([...this.rooms]);
  }

  private join(rooms: RoomName[]): void {
    const seqs: Record<string, number> = {};
    for (const room of rooms) {
      if (!room.startsWith('match:')) continue;
      const id = room.slice(6);
      const seq = this.seqs.get(id);
      if (seq !== undefined) seqs[id] = seq;
    }
    this.socket.emit('subscribe', { rooms, seqs }, () => undefined);
  }

  private armFallback(): void {
    clearTimeout(this.fallbackTimer);
    this.fallbackTimer = setTimeout(() => {
      if (!this.socket.connected) this.startPolling();
    }, this.opts.fallbackAfterMs ?? 10_000);
  }

  private startPolling(): void {
    if (!this.opts.poll || this.pollTimer) return;
    this.setState('polling');
    void this.opts.poll();
    this.pollTimer = setInterval(() => {
      // Hidden tabs don't need fresh scores; save the user's data.
      if (typeof document !== 'undefined' && document.hidden) return;
      void this.opts.poll?.();
    }, this.opts.pollEveryMs ?? 30_000);
  }

  private stopPolling(): void {
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  private readonly handleOffline = () => this.setState('offline');
  private readonly handleOnline = () => {
    if (this.socket.connected) this.setState('live');
    else {
      this.setState('reconnecting');
      this.socket.connect();
    }
  };

  private setState(state: ConnectionState): void {
    if (state === this.stateValue) return;
    this.stateValue = state;
    for (const l of this.listeners.state) l(state);
  }

  private add<K extends keyof LiveClient['listeners']>(
    kind: K,
    l: Parameters<LiveClient['listeners'][K]['add']>[0],
  ): () => void {
    (this.listeners[kind] as Set<typeof l>).add(l);
    return () => (this.listeners[kind] as Set<typeof l>).delete(l);
  }
}
