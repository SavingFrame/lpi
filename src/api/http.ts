import websocket from '@fastify/websocket';
import Fastify, { type FastifyRequest, type RouteHandlerMethod } from 'fastify';
import type { NativeBridges } from '../bridge/server.js';
import type { Config } from '../config.js';
import type { Events } from '../events.js';
import { Launches } from '../launches.js';
import { ProviderUsageService } from '../provider-usage.js';
import type { Sessions } from '../sessions.js';
import { COMMAND_BODY_LIMIT } from '../shared/attachments.js';
import { BRIDGE_LIMIT } from '../shared/commands.js';
import { AppError, object, text } from '../shared/errors.js';
import { serveFrontend } from './frontend.js';
import { registerProjectRoutes } from './projects.js';
import { validateRequest } from './security.js';
import { registerSessionRoutes } from './sessions.js';
import { registerWebSocketRoutes } from './websocket.js';

export async function createApi(
  config: Config,
  sessions: Sessions,
  bridges: NativeBridges,
  events: Events,
  frontendDirectory = 'frontend/dist',
  launches = new Launches(config, sessions, bridges),
  usage = new ProviderUsageService(),
) {
  const app = Fastify({
    bodyLimit: COMMAND_BODY_LIMIT,
    requestTimeout: 15_000,
    forceCloseConnections: true,
    exposeHeadRoutes: false,
  });
  await app.register(websocket, {
    // The plugin has one transport limit shared by events and native bridges.
    options: { maxPayload: BRIDGE_LIMIT, perMessageDeflate: false },
    preClose(done) {
      for (const socket of this.websocketServer.clients) {
        socket.terminate();
      }
      this.websocketServer.close(done);
    },
  });
  const usedRequests = new Set<string>();
  const requestIds = new WeakMap<FastifyRequest, string>();
  const inFlight = new Set<FastifyRequest>();

  app.addHook('onRequest', async (request, reply) => {
    validateRequest(request.raw, config, request.method === 'OPTIONS');
    reply.header('Cache-Control', 'no-store');
    if (request.headers.origin) {
      reply.header('Access-Control-Allow-Origin', request.headers.origin);
      reply.header('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      return reply
        .header('Access-Control-Allow-Methods', 'GET, POST')
        .header('Access-Control-Allow-Headers', 'Content-Type')
        .code(204)
        .send();
    }
    if (!request.routeOptions.url) {
      throw new AppError('Route not found', 404);
    }
    const { id } = request.params as { id?: string };
    if (id !== undefined && !/^[a-f0-9-]{36}$/.test(id)) {
      throw new AppError('Route not found', 404);
    }
  });

  // Keep the relay's JSON-only input contract. Fastify enforces the body limit
  // before this parser runs, including when Content-Length is absent.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    try {
      done(null, object(JSON.parse(body.toString())));
    } catch (error) {
      done(error instanceof AppError ? error : new AppError('Invalid JSON', 400));
    }
  });

  app.addHook('onRequestAbort', async (request) => {
    inFlight.delete(request);
  });
  app.setErrorHandler((error, request, reply) => {
    inFlight.delete(request);
    const known = error instanceof AppError;
    const parserErrors: Record<string, [number, string]> = {
      FST_ERR_CTP_BODY_TOO_LARGE: [413, 'Request body too large'],
      FST_ERR_CTP_INVALID_MEDIA_TYPE: [415, 'Content-Type must be application/json'],
      FST_ERR_CTP_EMPTY_JSON_BODY: [400, 'Invalid JSON'],
      FST_ERR_CTP_INVALID_CONTENT_LENGTH: [400, 'Invalid Content-Length'],
    };
    const parserError =
      error instanceof Error && 'code' in error ? parserErrors[String(error.code)] : undefined;
    reply
      .header('Cache-Control', 'no-store')
      .code(known ? error.status : (parserError?.[0] ?? 500))
      .send({
        requestId: requestIds.get(request),
        error: known ? error.message : (parserError?.[1] ?? 'Internal server failure'),
        outcome: known ? error.outcome : parserError ? 'rejected' : 'unknown',
      });
  });
  app.setNotFoundHandler(() => {
    throw new AppError('Route not found', 404);
  });

  function post(
    path: string,
    handler: (body: Record<string, unknown>, id: string) => unknown,
  ): void {
    app.post(
      path,
      {
        preParsing: async (request, _reply, payload) => {
          if (inFlight.size >= 128) {
            throw new AppError('Request concurrency limit reached', 429);
          }
          inFlight.add(request);
          if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
            throw new AppError('Content-Type must be application/json', 415);
          }
          return payload;
        },
      },
      async (request) => {
        try {
          const raw = object(request.body);
          const requestId = text(raw.requestId, 'request ID', 128);
          requestIds.set(request, requestId);
          if (usedRequests.has(requestId)) {
            throw new AppError(
              'Request ID already used; inspect state instead of replaying',
              409,
              'unknown',
            );
          }
          if (usedRequests.size >= 100_000) {
            throw new AppError('Request ID capacity reached; restart the relay', 503);
          }
          usedRequests.add(requestId);
          const data = await handler(raw, (request.params as { id?: string }).id ?? '');
          return { requestId, outcome: 'acknowledged', data };
        } finally {
          inFlight.delete(request);
        }
      },
    );
  }

  registerWebSocketRoutes(app, events, bridges);
  registerProjectRoutes(app, config);
  app.get('/usage', () => usage.get());
  app.addHook('preClose', async () => usage.close());
  registerSessionRoutes(app, post, sessions, bridges, launches);
  const frontend: RouteHandlerMethod = async (request, reply) => {
    if (
      !(await serveFrontend(
        new URL(request.url, 'http://localhost').pathname,
        reply,
        frontendDirectory,
      ))
    ) {
      throw new AppError('Route not found', 404);
    }
    return reply;
  };

  for (const path of ['/', '/app', '/app/*', '/assets/*', '/display']) {
    app.get(path, frontend);
  }

  app.addHook('onClose', async () => sessions.close());
  app.server.headersTimeout = 10_000;
  app.server.maxConnections = 256;
  return app;
}
