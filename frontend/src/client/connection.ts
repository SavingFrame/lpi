import {
  desktopRelayOrigin,
  isRelayProfileId,
  type RelayProfile,
} from '../../../src/shared/desktop.ts';

const meta = (name: string) =>
  typeof document === 'undefined'
    ? undefined
    : document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content;

const configured = meta('lpi-relay-origin');
const serialized = meta('lpi-relay-profiles');
const profiles: unknown =
  serialized === undefined
    ? configured === undefined
      ? []
      : [{ id: meta('lpi-relay-profile'), name: new URL(configured).hostname, origin: configured }]
    : JSON.parse(serialized);
if (!Array.isArray(profiles) || (configured !== undefined && profiles.length === 0)) {
  throw new Error('Invalid desktop relay profiles');
}
export const relayProfiles: RelayProfile[] = profiles.map((value: unknown) => {
  if (
    !value ||
    typeof value !== 'object' ||
    !('id' in value) ||
    !isRelayProfileId(value.id) ||
    !('name' in value) ||
    typeof value.name !== 'string' ||
    !('origin' in value) ||
    typeof value.origin !== 'string'
  ) {
    throw new Error('Invalid desktop relay profile');
  }
  return { id: value.id, name: value.name, origin: desktopRelayOrigin(value.origin) };
});
