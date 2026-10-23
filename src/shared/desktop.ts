export const DESKTOP_SCHEME = 'pim-app';
export const DESKTOP_ORIGIN = 'pim-app://app';
export interface DesktopPlatform {
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
      'PIM_DESKTOP_SERVER must be an HTTPS origin (or HTTP on loopback), without credentials',
    );
  }
  return url.origin;
}
