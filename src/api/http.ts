import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { COMMAND_BODY_LIMIT } from '../attachments.js';
import { bridgeCommand } from '../bridge/protocol.js';
import type { NativeBridges } from '../bridge/server.js';
import type { Config } from '../config.js';
import { AppError, generation, object, text } from '../errors.js';
import { Launches } from '../launches.js';
import type { Sessions } from '../sessions.js';
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
    if (size > COMMAND_BODY_LIMIT) {
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
  sessions: Sessions,
  bridges: NativeBridges,
  frontendDirectory = 'frontend/dist',
  launches = new Launches(config, sessions, bridges),
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
        send(response, 200, { sessions: sessions.list() });
        return;
      }
      const match = /^\/sessions\/([a-f0-9-]{36})(?:\/(commands|snapshot|resume|viewed))?$/.exec(
        path,
      );
      if (request.method === 'GET' && match?.[2] === 'snapshot') {
        send(response, 200, sessions.snapshot(String(match[1])));
        return;
      }
      if (request.method === 'GET' && match && !match[2]) {
        send(response, 200, sessions.get(String(match[1])));
        return;
      }
      const creating = path === '/sessions';
      const resuming = match?.[2] === 'resume';
      const viewing = match?.[2] === 'viewed';
      if (
        request.method !== 'POST' ||
        (!creating && !resuming && !viewing && match?.[2] !== 'commands')
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
        throw new AppError('Request ID capacity reached; restart the relay', 503);
      }
      usedRequests.add(requestId);
      if (viewing) {
        const completionId = text(raw.completionId, 'completion ID', 128);
        if (!/^[a-f0-9-]{36}$/.test(completionId)) {
          throw new AppError('Invalid completion ID', 400);
        }
        const readState = sessions.markViewed(String(match?.[1]), completionId);
        send(response, 200, { requestId, outcome: 'acknowledged', data: { readState } });
        return;
      }
      if (creating || resuming) {
        const id = resuming ? String(match?.[1]) : undefined;
        const projectId = id ? sessions.get(id).projectId : text(raw.projectId, 'project ID', 128);
        const session = await launches.start(projectId, id, raw.confirmedOffline === true);
        send(response, 200, { requestId, outcome: 'acknowledged', data: { session } });
        return;
      }
      const id = String(match?.[1]);
      sessions.get(id);
      const data = await bridges.command(
        id,
        generation(raw.generation),
        bridgeCommand(raw.command),
      );
      send(response, 200, { requestId, outcome: 'acknowledged', data });
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

  server.once('close', () => sessions.close());
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 256;
  return server;
}
