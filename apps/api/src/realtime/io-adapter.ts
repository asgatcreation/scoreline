import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';
import { corsOrigins } from '../config.js';

/**
 * Socket.IO settings, applied when the server starts (after .env has been
 * loaded), so the allowed origins always match WEB_ORIGIN.
 */
export class ScorelineIoAdapter extends IoAdapter {
  override createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: corsOrigins(), methods: ['GET', 'POST'] },
      // WebSocket first, HTTP long-polling when a network blocks WebSockets.
      transports: ['websocket', 'polling'],
      pingInterval: 25_000,
      pingTimeout: 20_000,
      // Clients only send tiny subscribe messages.
      maxHttpBufferSize: 16_000,
      // A client that drops for under two minutes gets its rooms back and
      // every message it missed, without asking.
      connectionStateRecovery: { maxDisconnectionDuration: 2 * 60_000, skipMiddlewares: true },
    } as ServerOptions);
  }
}
