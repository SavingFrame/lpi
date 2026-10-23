import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import { searchProjectFiles } from '../project-files.js';
import { AppError } from '../shared/errors.js';

export function registerProjectRoutes(app: FastifyInstance, config: Config): void {
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
