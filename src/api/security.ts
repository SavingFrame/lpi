import type { IncomingMessage } from 'node:http';
import type { Config } from '../config.js';
import { AppError } from '../shared/errors.js';

export function validateRequest(request: IncomingMessage, config: Config, preflight = false): void {
  const host = request.headers.host;
  const allowedHosts = new Set([
    `127.0.0.1:${config.port}`,
    `localhost:${config.port}`,
    `[::1]:${config.port}`,
    ...config.origins
      .filter((origin) => /^https?:/.test(origin))
      .map((origin) => new URL(origin).host),
  ]);
  if (!host || !allowedHosts.has(host)) {
    throw new AppError('Host rejected', 403);
  }
  if (request.headers.origin && !config.origins.includes(request.headers.origin)) {
    throw new AppError('Origin rejected', 403);
  }
  if (preflight) {
    if (!request.headers.origin) {
      throw new AppError('Preflight requires an allowed origin', 403);
    }
  }
}
