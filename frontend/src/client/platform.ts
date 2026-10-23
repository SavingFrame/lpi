import type { DesktopPlatform } from '../../../src/shared/desktop';

export type { DesktopPlatform } from '../../../src/shared/desktop';

declare global {
  interface Window {
    pimDesktop?: DesktopPlatform;
  }
}

export const desktop = typeof window === 'undefined' ? undefined : window.pimDesktop;
