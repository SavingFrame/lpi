import { type ClientStorage, serializedStorage } from '../../../src/client/storage.ts';
import { MAX_RELAY_PROFILES, type RelayProfileInput } from '../../../src/shared/desktop.ts';
import { serverPreferenceKey } from './connection.ts';
import type { InventoryState, MobileRelay } from './relay.ts';
import { relayOrigin } from './server.ts';

const profilesKey = 'lpi:mobile:relays:v1';
const focusedKey = 'lpi:mobile:focused-relay';

function validateProfiles(value: unknown): RelayProfileInput[] {
  if (!Array.isArray(value) || value.length > MAX_RELAY_PROFILES) {
    throw new Error(`Save up to ${MAX_RELAY_PROFILES} relays.`);
  }
  const seen = new Set<string>();
  return value.map((profile: unknown) => {
    if (
      !profile ||
      typeof profile !== 'object' ||
      !('name' in profile) ||
      typeof profile.name !== 'string' ||
      !('origin' in profile) ||
      typeof profile.origin !== 'string'
    ) {
      throw new Error('Each relay needs a name and address.');
    }
    const name = profile.name.trim();
    if (!name || name.length > 60 || /\p{Cc}/u.test(name)) {
      throw new Error('Relay names must contain 1 to 60 printable characters.');
    }
    if (profile.origin.length > 512) {
      throw new Error('Relay address is too long.');
    }
    const origin = relayOrigin(profile.origin);
    if (seen.has(origin)) {
      throw new Error('That relay address is already saved.');
    }
    seen.add(origin);
    return { name, origin };
  });
}

export interface MobileDevice extends RelayProfileInput {
  client: MobileRelay;
  inventory: InventoryState;
  status: 'online' | 'connecting' | 'offline';
}

interface WorkspaceState {
  devices: MobileDevice[];
  focused: MobileDevice | undefined;
}

/** Owns relay lifecycles. A profile name is display-only; storage is still keyed by origin. */
export class MobileWorkspace {
  private readonly storage: ClientStorage;
  private readonly create: (origin: string) => MobileRelay;
  private readonly clients = new Map<string, { client: MobileRelay; release: () => void }>();
  private readonly listeners = new Set<() => void>();
  private profiles: RelayProfileInput[] = [];
  private focusedOrigin: string | undefined;
  private state: WorkspaceState = { devices: [], focused: undefined };
  private active = false;
  private saving = false;
  private navigation = 0;

  constructor(storage: ClientStorage, create: (origin: string) => MobileRelay) {
    this.storage = serializedStorage(storage);
    this.create = create;
  }

  getState = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  load = async (): Promise<void> => {
    const [saved, focused] = await Promise.all([
      this.storage.getItem(profilesKey),
      this.storage.getItem(focusedKey),
    ]);
    const legacy = saved === null ? await this.storage.getItem(serverPreferenceKey) : null;
    const profiles = validateProfiles(
      saved !== null
        ? JSON.parse(saved)
        : legacy
          ? [{ origin: legacy, name: new URL(relayOrigin(legacy)).hostname.slice(0, 60) }]
          : [],
    );
    this.focusedOrigin = focused ?? undefined;
    this.reconcile(profiles);
  };

  save = async (value: RelayProfileInput[]): Promise<void> => {
    if (this.saving) {
      throw new Error('Relay settings are already being saved.');
    }
    const profiles = validateProfiles(value);
    this.saving = true;
    try {
      await this.storage.setItem(profilesKey, JSON.stringify(profiles));
      this.reconcile(profiles);
    } finally {
      this.saving = false;
    }
  };

  setActive = (active: boolean): void => {
    if (this.active === active) {
      return;
    }
    this.active = active;
    this.navigation++;
    for (const { client } of this.clients.values()) {
      if (active) {
        void client.start();
      } else {
        client.stop();
      }
    }
  };

  select = (origin: string, id: string): void => {
    const client = this.clients.get(origin)?.client;
    if (!client?.getState().sessions.some((session) => session.id === id)) {
      return;
    }
    // Focus only after selecting the new ID, so the previous selection is not fetched.
    void client.select(id);
    this.focus(origin);
  };

  openLink = (id: string): boolean => {
    const [relay, ...others] = this.state.devices;
    if (!relay || others.length) {
      return false;
    }
    this.navigation++;
    relay.client.openSession(id);
    return true;
  };

  launch = async (origin: string, projectId: string): Promise<boolean> => {
    const client = this.clients.get(origin)?.client;
    if (!client) {
      return false;
    }
    const navigation = ++this.navigation;
    const current = () =>
      this.active && this.navigation === navigation && this.clients.get(origin)?.client === client;
    const selected = await client.createSession(projectId, current);
    if (selected && current()) {
      this.focus(origin);
      return true;
    }
    return false;
  };

  private focus(origin: string): void {
    this.navigation++;
    this.focusedOrigin = origin;
    this.syncFocus();
    this.publish();
    void Promise.resolve(this.storage.setItem(focusedKey, origin)).catch(() => {});
  }

  private syncFocus(): void {
    for (const [origin, { client }] of this.clients) {
      if (origin !== this.focusedOrigin) {
        client.setFocused(false);
      }
    }
    if (this.focusedOrigin) {
      this.clients.get(this.focusedOrigin)?.client.setFocused(true);
    }
  }

  private reconcile(profiles: RelayProfileInput[]): void {
    const origins = new Set(profiles.map((profile) => profile.origin));
    for (const [origin, { client, release }] of this.clients) {
      if (!origins.has(origin)) {
        release();
        client.stop();
        this.clients.delete(origin);
      }
    }
    this.profiles = profiles;
    if (!this.focusedOrigin || !origins.has(this.focusedOrigin)) {
      this.focusedOrigin = profiles[0]?.origin;
      this.navigation++;
    }
    for (const { origin } of profiles) {
      if (this.clients.has(origin)) {
        continue;
      }
      const client = this.create(origin);
      const unsubscribe = client.subscribe(this.publish);
      const unlive = client.live.subscribe(this.publish);
      this.clients.set(origin, {
        client,
        release: () => {
          unsubscribe();
          unlive();
        },
      });
      client.setFocused(origin === this.focusedOrigin);
      if (this.active) {
        void client.start();
      }
    }
    this.syncFocus();
    this.publish();
  }

  private publish = (): void => {
    const devices = this.profiles.flatMap((profile): MobileDevice[] => {
      const client = this.clients.get(profile.origin)?.client;
      if (!client) {
        return [];
      }
      const inventory = client.getState();
      const status = client.live.getState().status;
      return [
        {
          ...profile,
          client,
          inventory,
          status: status === 'offline' ? 'offline' : inventory.fresh ? 'online' : 'connecting',
        },
      ];
    });
    const focused = devices.find((device) => device.origin === this.focusedOrigin);
    if (
      devices.length === this.state.devices.length &&
      focused?.origin === this.state.focused?.origin &&
      devices.every((device, i) => {
        const previous = this.state.devices[i];
        return (
          previous?.client === device.client &&
          previous.name === device.name &&
          previous.status === device.status &&
          previous.inventory === device.inventory
        );
      })
    ) {
      return;
    }
    this.state = { devices, focused };
    for (const listener of this.listeners) {
      listener();
    }
  };
}
