import { readFile, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { DESKTOP_ORIGIN } from '../src/shared/desktop.js';
import { DISPLAY_CSP } from '../src/shared/display.js';
import { displayDocument } from '../src/shared/display-document.js';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export async function bundledResponse(
  request: Request,
  directory: string,
  relay: string,
): Promise<Response> {
  const url = new URL(request.url);
  if (
    url.protocol !== new URL(DESKTOP_ORIGIN).protocol ||
    url.host !== new URL(DESKTOP_ORIGIN).host ||
    url.username ||
    url.password
  ) {
    return new Response('Not found', { status: 404 });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  if (url.pathname === '/display') {
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set(
      'Content-Security-Policy',
      `${DISPLAY_CSP}; sandbox allow-scripts; frame-ancestors 'self'`,
    );
    headers.set(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    return new Response(request.method === 'HEAD' ? null : displayDocument(), { headers });
  }
  const page = url.pathname === '/' || url.pathname === '/app' || url.pathname.startsWith('/app/');
  if (!page && !url.pathname.startsWith('/assets/')) {
    return new Response('Not found', { status: 404 });
  }
  try {
    const root = await realpath(directory);
    const file = await realpath(
      resolve(root, page ? 'index.html' : `.${decodeURIComponent(url.pathname)}`),
    );
    const path = relative(root, file);
    if (path === '..' || path.startsWith('../') || path.startsWith('..\\') || isAbsolute(path)) {
      return new Response('Not found', { status: 404 });
    }
    const bytes = await readFile(file);
    headers.set('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    // The endpoint is validated before registration. Serialize it as HTML attribute data, not code.
    const escaped = relay
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;');
    const body = page
      ? bytes
          .toString('utf8')
          .replace('</head>', `<meta name="pim-relay-origin" content="${escaped}"></head>`)
      : Uint8Array.from(bytes);
    const socket = new URL(relay);
    socket.protocol = socket.protocol === 'https:' ? 'wss:' : 'ws:';
    headers.set(
      'Content-Security-Policy',
      `default-src 'self'; connect-src 'self' ${relay} ${socket.origin}; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    );
    return new Response(request.method === 'HEAD' ? null : body, { headers });
  } catch {
    return new Response('Bundle not found. Run npm run build:desktop.', { status: 404 });
  }
}
