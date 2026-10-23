import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { FastifyReply } from 'fastify';
import { DISPLAY_CSP } from '../shared/display.ts';
import { displayDocument } from '../shared/display-document.ts';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export async function serveFrontend(
  path: string,
  response: FastifyReply,
  directory: string,
): Promise<boolean> {
  if (path === '/display') {
    // Static, sandboxed shell only. Artifact bytes arrive from its parent frame,
    // never from a file-serving endpoint, URL parameter, or another session writer.
    response.code(200).headers({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'Content-Security-Policy': `${DISPLAY_CSP}; sandbox allow-scripts; frame-ancestors 'self'`,
    });
    response.send(displayDocument());
    return true;
  }
  const page = path === '/' || path === '/app' || path.startsWith('/app/');
  if (!page && !path.startsWith('/assets/')) {
    return false;
  }
  const root = resolve(directory);
  const file = page ? resolve(root, 'index.html') : resolve(root, `.${decodeURIComponent(path)}`);
  if (!file.startsWith(`${root}${sep}`)) {
    return false;
  }
  try {
    const data = await readFile(file);
    response.code(200).headers({
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': page ? 'no-store' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      // The diff viewer injects shadow-DOM styles and token style attributes.
      // Allow inline CSS only. Inline scripts, eval and external sources stay blocked.
      'Content-Security-Policy':
        "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    });
    response.send(data);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
