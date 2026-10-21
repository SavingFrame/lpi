import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { NativeBridges } from '../bridge/server.js';
import type { Config } from '../config.js';
import type { Events } from '../events.js';
import { EVENT_BUFFER_LIMIT } from '../shared/attachments.js';
import { validateRequest } from './security.js';

export function attachWebSockets(
  server: Server,
  config: Config,
  events: Events,
  bridges: NativeBridges,
): () => void {
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    perMessageDeflate: false,
  });
  server.on('upgrade', (request, socket, head) => {
    try {
      validateRequest(request, config);
      if (request.url === '/bridge') {
        bridges.upgrade(request, socket, head);
        return;
      }
      if (request.url !== '/events' || sockets.clients.size >= 32) {
        throw new Error('Upgrade rejected');
      }
      sockets.handleUpgrade(request, socket, head, (client) => sockets.emit('connection', client));
    } catch {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    }
  });
  sockets.on('connection', (socket) => {
    socket.on('error', () => socket.terminate());
    socket.on('message', () => socket.close(1008, 'Use REST for commands'));
    socket.send(JSON.stringify({ type: 'connected', replay: false, ...events.checkpoint() }));
  });
  const unsubscribe = events.subscribe((event) => {
    const serialized = JSON.stringify(event);
    // Large native events are already in the relay snapshot. Invalidate browser caches
    // instead of treating one large result as a slow peer and disconnecting them.
    const data =
      event.type === 'pi-event' && Buffer.byteLength(serialized) > EVENT_BUFFER_LIMIT
        ? JSON.stringify({ ...event, type: 'bridge-sync', data: null })
        : serialized;
    for (const socket of sockets.clients) {
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
  const alive = new WeakSet<WebSocket>();
  sockets.on('connection', (socket) => {
    alive.add(socket);
    socket.on('pong', () => alive.add(socket));
  });
  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) {
      if (!alive.has(socket)) {
        socket.terminate();
      } else {
        alive.delete(socket);
        socket.ping();
      }
    }
  }, 30_000);
  heartbeat.unref();
  return () => {
    clearInterval(heartbeat);
    bridges.close();
    unsubscribe();
    for (const socket of sockets.clients) {
      socket.terminate();
    }
    sockets.close();
  };
}
