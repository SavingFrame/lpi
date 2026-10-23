import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import type { NativeBridges } from '../bridge/server.js';
import type { Events } from '../events.js';
import { EVENT_BUFFER_LIMIT } from '../shared/attachments.js';
import { AppError } from '../shared/errors.js';

export function registerWebSocketRoutes(
  app: FastifyInstance,
  events: Events,
  bridges: NativeBridges,
): void {
  const sockets = new Set<WebSocket>();
  const alive = new WeakSet<WebSocket>();
  app.get(
    '/events',
    {
      websocket: true,
      preValidation: async (request) => {
        if (request.ws && (request.url !== '/events' || sockets.size >= 32)) {
          throw new AppError('Event upgrade rejected', 403);
        }
      },
    },
    (socket) => {
      if (sockets.size >= 32) {
        socket.terminate();
        return;
      }
      sockets.add(socket);
      alive.add(socket);
      socket.on('pong', () => alive.add(socket));
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => socket.terminate());
      socket.on('message', () => socket.close(1008, 'Use REST for commands'));
      socket.send(JSON.stringify({ type: 'connected', replay: false, ...events.checkpoint() }));
    },
  );
  app.get(
    '/bridge',
    {
      websocket: true,
      preValidation: async (request) => {
        if (request.ws) {
          if (request.url !== '/bridge') {
            throw new AppError('Bridge upgrade rejected', 403);
          }
          bridges.validateConnection(request.headers.origin);
        }
      },
    },
    (socket) => bridges.connect(socket),
  );

  const unsubscribe = events.subscribe((event) => {
    const serialized = JSON.stringify(event);
    // Large native events are already in the relay snapshot. Invalidate browser caches
    // instead of treating one large result as a slow peer and disconnecting them.
    const data =
      event.type === 'pi-event' && Buffer.byteLength(serialized) > EVENT_BUFFER_LIMIT
        ? JSON.stringify({ ...event, type: 'bridge-sync', data: null })
        : serialized;
    for (const socket of sockets) {
      if (socket.readyState !== WebSocket.OPEN) {
        continue;
      }
      if (socket.bufferedAmount + Buffer.byteLength(data) > EVENT_BUFFER_LIMIT) {
        socket.terminate(); // Never stall native event delivery for a slow browser.
      } else {
        socket.send(data);
      }
    }
  });
  const heartbeat = setInterval(() => {
    for (const socket of sockets) {
      if (!alive.has(socket)) {
        socket.terminate();
      } else {
        alive.delete(socket);
        socket.ping();
      }
    }
  }, 30_000);
  heartbeat.unref();
  app.addHook('preClose', async () => {
    clearInterval(heartbeat);
    unsubscribe();
    bridges.close();
  });
}
