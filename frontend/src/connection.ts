import { desktopRelayOrigin } from '../../src/shared/desktop.ts';

// Only the Electron protocol handler/dev launcher supplies this metadata.
// Browser builds keep their existing relative, same-origin transport.
const configured =
  typeof document === 'undefined'
    ? undefined
    : document.querySelector<HTMLMetaElement>('meta[name="pim-relay-origin"]')?.content;

export const relayServer = configured === undefined ? undefined : desktopRelayOrigin(configured);
