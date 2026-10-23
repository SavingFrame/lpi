import type { FastifyInstance } from 'fastify';
import type { NativeBridges } from '../bridge/server.js';
import type { Launches } from '../launches.js';
import type { Sessions } from '../sessions.js';
import { bridgeCommand } from '../shared/commands.js';
import { AppError, generation, text } from '../shared/errors.js';

type SessionRoute = { Params: { id: string } };

export function registerSessionRoutes(
  app: FastifyInstance,
  post: (path: string, handler: (body: Record<string, unknown>, id: string) => unknown) => void,
  sessions: Sessions,
  bridges: NativeBridges,
  launches: Launches,
): void {
  app.get('/sessions', async () => ({ sessions: sessions.list() }));
  app.get<SessionRoute>('/sessions/:id', async (request) => sessions.get(request.params.id));
  app.get<SessionRoute>('/sessions/:id/tree', async (request) => sessions.tree(request.params.id));
  app.get<SessionRoute>('/sessions/:id/snapshot', async (request) =>
    sessions.snapshot(request.params.id),
  );
  app.get<SessionRoute & { Querystring: { entryId?: unknown } }>(
    '/sessions/:id/branch',
    async (request) =>
      sessions.preview(request.params.id, text(request.query.entryId, 'entry ID', 128)),
  );

  post('/sessions', async (raw) => ({
    session: await launches.start(
      text(raw.projectId, 'project ID', 128),
      undefined,
      raw.confirmedOffline === true,
    ),
  }));
  post('/sessions/:id/resume', async (raw, id) => ({
    session: await launches.start(sessions.get(id).projectId, id, raw.confirmedOffline === true),
  }));
  post('/sessions/:id/archive', (raw, id) => {
    if (typeof raw.archived !== 'boolean') {
      throw new AppError('Invalid session archive state', 400);
    }
    sessions.setArchived(id, raw.archived);
    return { archived: raw.archived };
  });
  post('/sessions/:id/viewed', (raw, id) => {
    const completionId = text(raw.completionId, 'completion ID', 128);
    if (!/^[a-f0-9-]{36}$/.test(completionId)) {
      throw new AppError('Invalid completion ID', 400);
    }
    return { readState: sessions.markViewed(id, completionId) };
  });
  post('/sessions/:id/commands', async (raw, id) => {
    sessions.get(id);
    return bridges.command(id, generation(raw.generation), bridgeCommand(raw.command));
  });
}
