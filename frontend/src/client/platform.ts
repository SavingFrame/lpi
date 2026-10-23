import type { DesktopPlatform } from '../../../src/shared/desktop';

export type { DesktopPlatform } from '../../../src/shared/desktop';

declare global {
  interface Window {
    lpiDesktop?: DesktopPlatform;
  }
}

export const desktop = typeof window === 'undefined' ? undefined : window.lpiDesktop;
