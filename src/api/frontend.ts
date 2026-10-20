import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export async function serveFrontend(
  path: string,
  response: ServerResponse,
  directory: string,
): Promise<boolean> {
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
    response.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': page ? 'no-store' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    });
    response.end(data);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
