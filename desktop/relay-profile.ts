import { createHash } from 'node:crypto';
import { desktopRelayOrigin } from '../src/shared/desktop.ts';

/** Stable seed for the existing endpoint. A different origin is a different profile. */
export function seededRelayProfileId(origin: string): string {
  return createHash('sha256').update(desktopRelayOrigin(origin)).digest('hex');
}
