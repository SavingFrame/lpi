import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import type { Config } from '../config.js';
import { ProjectDiffWatch } from '../project-diff-watch.js';
import { searchProjectFiles } from '../project-files.js';
import { AppError } from '../shared/errors.js';

export function registerProjectRoutes(app: FastifyInstance, config: Config): void {
  const watches = new ProjectDiffWatch(config);
  const sockets = new Set<WebSocket>();
  const alive = new WeakSet<WebSocket>();
  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/diff/events',
    {
      websocket: true,
      preValidation: async (request) => {
        if (!request.ws) {
          throw new AppError('WebSocket upgrade required', 426);
        }
        if (request.url.includes('?') || sockets.size >= 32) {
          throw new AppError('Diff upgrade rejected', 403);
        }
        watches.validate(request.params.projectId);
      },
    },
    (socket, request) => {
      if (sockets.size >= 32) {
        socket.close(1013, 'Diff subscription limit reached');
        return;
      }
      sockets.add(socket);
      alive.add(socket);
      socket.on('pong', () => alive.add(socket));
      socket.on('error', () => socket.terminate());
      socket.on('message', () => socket.close(1008, 'Read-only diff subscription'));
      let release: () => void;
      try {
        release = watches.subscribe(request.params.projectId, () => {
          if (socket.readyState === WebSocket.OPEN) {
            if (socket.bufferedAmount > 64 * 1024) {
              socket.terminate();
            } else {
              socket.send(JSON.stringify({ type: 'diff-changed' }));
            }
          }
        });
      } catch {
        sockets.delete(socket);
        socket.close(1013, 'Diff subscription unavailable');
        return;
      }
      socket.on('close', () => {
        sockets.delete(socket);
        release();
      });
      socket.send(JSON.stringify({ type: 'diff-ready' }));
    },
  );
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
    watches.close();
    for (const socket of sockets) {
      socket.terminate();
    }
  });
  let diffs = 0;
  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/diff',
    async (request, reply) => {
      if (diffs >= 4) {
        throw new AppError('Diff concurrency limit reached', 429);
      }
      diffs++;
      const controller = new AbortController();
      const abort = () => controller.abort();
      const timeout = setTimeout(abort, 15_000);
      reply.raw.once('close', abort);
      try {
        return await watches.get(request.params.projectId, controller.signal);
      } finally {
        diffs--;
        clearTimeout(timeout);
        reply.raw.off('close', abort);
      }
    },
  );
  let fileSearches = 0;
  app.get('/projects', async () => ({ projects: config.projects }));
  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/files',
    async (request, reply) => {
      if (fileSearches >= 8) {
        throw new AppError('Project search concurrency limit reached', 429);
      }
      fileSearches++;
      const controller = new AbortController();
      const abort = () => controller.abort();
      reply.raw.once('close', abort);
      try {
        return await searchProjectFiles(
          config,
          request.params.projectId,
          new URL(request.url, 'http://localhost').searchParams.get('query') ?? '',
          controller.signal,
        );
      } finally {
        fileSearches--;
        reply.raw.off('close', abort);
      }
    },
  );
}
