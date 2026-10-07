import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Config } from '../config.js';
import type { Coordinator } from '../coordinator.js';
import { AppError, generation, object, text } from '../errors.js';
import { parseCommand } from '../rpc/protocol.js';
import { serveFrontend } from './frontend.js';
import { validateRequest } from './security.js';

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new AppError('Content-Type must be application/json', 415);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) {
      throw new AppError('Request body too large', 413);
    }
    chunks.push(buffer);
  }
  try {
    return object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('Invalid JSON', 400);
  }
}

function send(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

export function createApi(
  config: Config,
  coordinator: Coordinator,
  frontendDirectory = 'frontend/dist',
) {
  const usedRequests = new Set<string>();
  let inFlight = 0;
  const server = createServer((request, response) => {
    void handle(request, response);
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let counted = false;
    let requestId: string | undefined;
    try {
      validateRequest(request, config, request.method === 'OPTIONS');
      if (request.headers.origin) {
        response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
        response.setHeader('Vary', 'Origin');
      }
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        response.writeHead(204);
        response.end();
        return;
      }
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (request.method === 'GET' && (await serveFrontend(path, response, frontendDirectory))) {
        return;
      }
      if (request.method === 'GET' && path === '/projects') {
        send(response, 200, { projects: config.projects });
        return;
      }
      if (request.method === 'GET' && path === '/sessions') {
        send(response, 200, { sessions: coordinator.list() });
        return;
      }
      const match = /^\/sessions\/([a-f0-9-]{36})(?:\/(start|stop|commands|snapshot))?$/.exec(path);
      if (request.method === 'GET' && match?.[2] === 'snapshot') {
        send(response, 200, await coordinator.snapshot(String(match[1])));
        return;
      }
      if (request.method === 'GET' && match && !match[2]) {
        send(response, 200, coordinator.get(String(match[1])));
        return;
      }
      if (
        request.method !== 'POST' ||
        (path !== '/sessions' && (!match?.[2] || match[2] === 'snapshot'))
      ) {
        throw new AppError('Route not found', 404);
      }
      if (inFlight >= 128) {
        throw new AppError('Request concurrency limit reached', 429);
      }
      inFlight++;
      counted = true;
      const raw = await body(request);
      requestId = text(raw.requestId, 'request ID', 128);
      if (usedRequests.has(requestId)) {
        throw new AppError(
          'Request ID already used; inspect state instead of replaying',
          409,
          'unknown',
        );
      }
      if (usedRequests.size >= 100_000) {
        throw new AppError('Request ID capacity reached; restart after releasing runtimes', 503);
      }
      usedRequests.add(requestId);
      if (path === '/sessions') {
        send(response, 201, {
          requestId,
          outcome: 'completed',
          session: coordinator.create(text(raw.projectId, 'project ID', 64)),
        });
        return;
      }
      const id = String(match?.[1]);
      const expected = generation(raw.generation);
      if (match?.[2] === 'start') {
        send(response, 200, {
          requestId,
          outcome: 'completed',
          session: await coordinator.start(id, expected),
        });
      } else if (match?.[2] === 'stop') {
        send(response, 200, {
          requestId,
          outcome: 'completed',
          session: await coordinator.stop(id, expected),
        });
      } else {
        const command = parseCommand(raw.command);
        const data = await coordinator.command(id, expected, command);
        send(response, 200, { requestId, outcome: 'acknowledged', data });
      }
    } catch (error) {
      const known = error instanceof AppError;
      if (!response.destroyed && !response.writableEnded) {
        send(response, known ? error.status : 500, {
          requestId,
          error: known ? error.message : 'Internal server failure',
          outcome: known ? error.outcome : 'unknown',
        });
      }
    } finally {
      if (counted) {
        inFlight--;
      }
    }
  }

  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 256;
  return server;
}
