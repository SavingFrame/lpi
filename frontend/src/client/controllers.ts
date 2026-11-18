import { relayProfiles } from './connection.ts';
import { desktop } from './platform.ts';
import { createRelayClient } from './relay-client.ts';

export interface WorkspaceRelay {
  profileId?: string;
  name: string;
  client: ReturnType<typeof createRelayClient>;
}

const notify = desktop?.notify.bind(desktop);

export const workspaceRelays: WorkspaceRelay[] = relayProfiles.length
  ? relayProfiles.map((profile) => ({
      profileId: profile.id,
      name: profile.name,
      client: createRelayClient({
        relayOrigin: profile.origin,
        requireInventory: true,
        notify:
          notify &&
          ((notice) =>
            notify({
              ...notice,
              profileId: profile.id,
              title: `${profile.name}: ${notice.title}`.slice(0, 160),
            })),
      }),
    }))
  : [{ name: '', client: createRelayClient() }];

const byId = new Map(workspaceRelays.map((relay) => [relay.profileId, relay]));
export const relayFor = (profileId?: string) => byId.get(profileId);

const firstRelay = workspaceRelays[0];
if (!firstRelay) {
  throw new Error('No workspace relay');
}
export const defaultRelay = firstRelay;
export const defaultClient = defaultRelay.client;
