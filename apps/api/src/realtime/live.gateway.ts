import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  type ClientToServerEvents,
  MAX_ROOMS_PER_CLIENT,
  type MatchUpdateMessage,
  type RoomName,
  type ServerToClientEvents,
  type SubscribeAck,
  isLive,
  isRoomName,
} from '@scoreline/shared';
import type { Subscription } from 'rxjs';
import type { Server, Socket } from 'socket.io';
import { FootballQueryService } from '../football/football-query.service.js';
import { ChangeBus, type MatchChangeBatch } from '../ingest/change-bus.js';

type LiveServer = Server<ClientToServerEvents, ServerToClientEvents>;
type LiveSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Room-change messages allowed per socket in each 10-second window. */
const MESSAGE_LIMIT = 20;
const WINDOW_MS = 10_000;
const VIEWERS_DEBOUNCE_MS = 1_000;

/**
 * Real-time hub. Ingest and demo changes arrive on the ChangeBus and are
 * sent, as small deltas, only to the rooms that care.
 */
@WebSocketGateway()
export class LiveGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  @WebSocketServer() server!: LiveServer;
  private readonly logger = new Logger(LiveGateway.name);
  private sub?: Subscription;
  private readonly viewerTimers = new Map<string, NodeJS.Timeout>();
  private readonly budgets = new WeakMap<LiveSocket, { count: number; since: number }>();

  constructor(
    private readonly bus: ChangeBus,
    private readonly query: FootballQueryService,
  ) {}

  afterInit(): void {
    this.sub = this.bus.changes$.subscribe((batch) => this.broadcast(batch));
  }

  onModuleDestroy(): void {
    this.sub?.unsubscribe();
    for (const t of this.viewerTimers.values()) clearTimeout(t);
  }

  handleConnection(socket: LiveSocket): void {
    socket.emit('hello', { serverTime: new Date().toISOString() });
    socket.on('disconnecting', () => {
      for (const room of socket.rooms) {
        if (room.startsWith('match:')) this.scheduleViewers(room.slice(6));
      }
    });
  }

  broadcast(batch: MatchChangeBatch): void {
    const message: MatchUpdateMessage = {
      matchId: batch.matchId,
      seq: batch.seq,
      changes: batch.changes,
      summary: batch.summary,
    };
    const rooms: RoomName[] = [`match:${batch.matchId}`, `competition:${batch.competitionSlug}`];
    const wasLive = batch.changes.some((c) => c.type === 'status' && isLive(c.previous));
    if (isLive(batch.summary.status) || wasLive) rooms.push('live');
    // A socket in several of these rooms still receives the message once.
    this.server.to(rooms).emit('match:update', message);
  }

  @SubscribeMessage('subscribe')
  async subscribe(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: unknown,
  ): Promise<SubscribeAck> {
    if (!this.withinBudget(socket)) {
      return { ok: false, joined: [], rejected: [], error: 'too many requests, slow down' };
    }
    const req = (body ?? {}) as { rooms?: unknown; seqs?: unknown };
    const requested = Array.isArray(req.rooms) ? req.rooms.slice(0, MAX_ROOMS_PER_CLIENT) : [];
    const joined = requested.filter(isRoomName);
    const rejected = requested.filter((r) => !isRoomName(r)).map((r) => String(r).slice(0, 60));

    const current = [...socket.rooms].filter((r) => r !== socket.id).length;
    const fresh = joined.filter((r) => !socket.rooms.has(r));
    if (current + fresh.length > MAX_ROOMS_PER_CLIENT) {
      return { ok: false, joined: [], rejected: requested.map(String), error: 'too many rooms' };
    }

    await socket.join(joined);
    for (const room of fresh) if (room.startsWith('match:')) this.scheduleViewers(room.slice(6));
    await this.resync(socket, joined, req.seqs);
    return { ok: true, joined, rejected };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: unknown,
  ): Promise<{ ok: boolean }> {
    if (!this.withinBudget(socket)) return { ok: false };
    const rooms = (body as { rooms?: unknown })?.rooms;
    if (!Array.isArray(rooms)) return { ok: false };
    for (const room of rooms.filter(isRoomName)) {
      if (!socket.rooms.has(room)) continue;
      await socket.leave(room);
      if (room.startsWith('match:')) this.scheduleViewers(room.slice(6));
    }
    return { ok: true };
  }

  /** People watching one match right now. */
  viewers(matchId: string): number {
    return this.server.sockets.adapter.rooms.get(`match:${matchId}`)?.size ?? 0;
  }

  /**
   * A client that was away longer than Socket.IO's recovery window sends
   * the last seq it saw; anything newer gets a fresh summary.
   */
  private async resync(socket: LiveSocket, rooms: RoomName[], seqs: unknown): Promise<void> {
    if (!seqs || typeof seqs !== 'object') return;
    const matchIds = rooms.filter((r) => r.startsWith('match:')).map((r) => r.slice(6));
    for (const matchId of matchIds) {
      const seen = (seqs as Record<string, unknown>)[matchId];
      if (typeof seen !== 'number') continue;
      try {
        const summary = await this.query.summaryById(matchId);
        if (summary && summary.seq !== seen) socket.emit('match:sync', { matchId, summary });
      } catch (err) {
        this.logger.warn(`Resync of ${matchId} failed: ${(err as Error).message}`);
      }
    }
  }

  private scheduleViewers(matchId: string): void {
    if (this.viewerTimers.has(matchId)) return;
    this.viewerTimers.set(
      matchId,
      setTimeout(() => {
        this.viewerTimers.delete(matchId);
        this.server
          .to(`match:${matchId}`)
          .emit('viewers', { matchId, count: this.viewers(matchId) });
      }, VIEWERS_DEBOUNCE_MS),
    );
  }

  private withinBudget(socket: LiveSocket): boolean {
    const now = Date.now();
    const budget = this.budgets.get(socket);
    if (!budget || now - budget.since > WINDOW_MS) {
      this.budgets.set(socket, { count: 1, since: now });
      return true;
    }
    budget.count++;
    if (budget.count > MESSAGE_LIMIT * 3) {
      this.logger.warn(`Disconnecting ${socket.id}: flooding room requests`);
      socket.disconnect(true);
    }
    return budget.count <= MESSAGE_LIMIT;
  }
}
