export const DESKTOP_SCHEME = 'lpi-app';
export const DESKTOP_ORIGIN = 'lpi-app://app';
export interface DesktopNotification {
  sessionId: string;
  projectId: string;
  title: string;
  body: string;
  kind: 'finished' | 'input' | 'error';
}

export function isDesktopNotification(value: unknown): value is DesktopNotification {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.sessionId === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item.sessionId) &&
    typeof item.projectId === 'string' &&
    /^[a-f0-9]{64}$/.test(item.projectId) &&
    typeof item.title === 'string' &&
    item.title.length <= 160 &&
    typeof item.body === 'string' &&
    item.body.length <= 200 &&
    typeof item.kind === 'string' &&
    ['finished', 'input', 'error'].includes(item.kind)
  );
}

export interface DesktopPlatform {
  onCloseTab(listener: () => void): () => void;
  notify(notification: DesktopNotification): Promise<void>;
  onNotificationClicked(listener: (notification: DesktopNotification) => void): () => void;
  getZoom(): Promise<number>;
  setZoom(factor: number): Promise<number>;
  onZoomChanged(listener: (factor: number) => void): () => void;
}

/** A relay endpoint, never a UI URL or a URL carrying credentials. */
export function desktopRelayOrigin(value = 'http://127.0.0.1:3141'): string {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'LPI_DESKTOP_SERVER must be an HTTPS origin (or HTTP on loopback), without credentials',
    );
  }
  return url.origin;
}
