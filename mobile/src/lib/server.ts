/** Only explicit relay origins are accepted. Credentials and reverse-proxy paths are unsupported. */
export function relayOrigin(value: string): string {
  const url = new URL(value.trim());
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error(
      'Enter an HTTP or HTTPS server origin without credentials, paths, or query parameters.',
    );
  }
  return url.origin;
}

export function eventsUrl(origin: string): string {
  const url = new URL('/events', origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}
