import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import { readProjectDiff } from '../project-diff.js';
import { searchProjectFiles } from '../project-files.js';
import { AppError } from '../shared/errors.js';

export function registerProjectRoutes(app: FastifyInstance, config: Config): void {
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
        return await readProjectDiff(config, request.params.projectId, controller.signal);
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
