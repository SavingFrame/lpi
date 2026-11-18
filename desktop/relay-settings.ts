import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  desktopRelayOrigin,
  MAX_RELAY_PROFILES,
  type RelayProfile,
} from '../src/shared/desktop.ts';
import { seededRelayProfileId } from './relay-profile.ts';

export function seedRelayProfile(value: string): RelayProfile {
  const origin = desktopRelayOrigin(value);
  return { id: seededRelayProfileId(origin), name: new URL(origin).hostname, origin };
}

function validateRelayProfiles(value: unknown): RelayProfile[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_RELAY_PROFILES) {
    throw new Error(`Save between 1 and ${MAX_RELAY_PROFILES} relay profiles.`);
  }
  const origins = new Set<string>();
  return Array.from(value, (item: unknown) => {
    if (
      item === null ||
      typeof item !== 'object' ||
      !('name' in item) ||
      typeof item.name !== 'string' ||
      !('origin' in item) ||
      typeof item.origin !== 'string'
    ) {
      throw new Error('Each relay needs a name and an origin.');
    }
    const name = item.name.trim();
    if (!name || name.length > 60 || /\p{Cc}/u.test(name)) {
      throw new Error('Relay names must contain 1 to 60 printable characters.');
    }
    if (item.origin.length > 512) {
      throw new Error('Relay origin is too long.');
    }
    const origin = desktopRelayOrigin(item.origin.trim());
    if (origins.has(origin)) {
      throw new Error(`Relay origin is already listed: ${origin}`);
    }
    origins.add(origin);
    return { id: seededRelayProfileId(origin), name, origin };
  });
}

export class RelaySettings {
  private readonly path: string;
  private saved: RelayProfile[];

  constructor(path: string, seed: string) {
    this.path = path;
    try {
      this.saved = validateRelayProfiles(JSON.parse(readFileSync(path, 'utf8')));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        console.error('Could not load saved desktop relay profiles. Using the launch default.');
      }
      this.saved = [seedRelayProfile(seed)];
    }
  }

  get profiles(): RelayProfile[] {
    return this.saved.map((profile) => ({ ...profile }));
  }

  save(value: unknown): void {
    const next = validateRelayProfiles(value);
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(
      `${this.path}.tmp`,
      `${JSON.stringify(
        next.map(({ name, origin }) => ({ name, origin })),
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    renameSync(`${this.path}.tmp`, this.path);
    this.saved = next;
  }
}
