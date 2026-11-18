import { useEffect, useState } from 'react';
import {
  desktopRelayOrigin,
  MAX_RELAY_PROFILES,
  type RelayProfileInput,
  type DesktopRelaySettings as RelaySettings,
} from '../../../src/shared/desktop';
import { workspaceRelays } from '../client/controllers';
import type { DesktopPlatform } from '../client/platform';
import { useWorkspaceInventory } from '../client/workspace-inventory';
import { Button } from '../components/ui/button';

export function DesktopRelaySettings({ platform }: { platform: DesktopPlatform }) {
  const [saved, setSaved] = useState<RelaySettings>();
  const [profiles, setProfiles] = useState<RelayProfileInput[]>([]);
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inventory = useWorkspaceInventory();
  useEffect(() => {
    let active = true;
    void platform.getRelaySettings().then(
      (settings) => {
        if (active) {
          setSaved(settings);
          setProfiles(settings.profiles.map(({ name, origin }) => ({ name, origin })));
        }
      },
      () => {
        if (active) {
          setError('Could not load relay settings.');
        }
      },
    );
    return () => {
      active = false;
    };
  }, [platform]);
  const dirty =
    saved &&
    JSON.stringify(profiles) !==
      JSON.stringify(saved.profiles.map(({ name, origin }) => ({ name, origin })));

  async function save() {
    setBusy(true);
    setError('');
    try {
      const settings = await platform.saveRelaySettings(profiles);
      setSaved(settings);
      setProfiles(settings.profiles.map(({ name, origin }) => ({ name, origin })));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save relay settings.');
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setError('');
    if (workspaceRelays.some(({ client }) => client.hasPendingMutation())) {
      setError('Wait for the pending relay action to finish before reloading.');
      return;
    }
    setBusy(true);
    try {
      await platform.applyRelaySettings();
    } catch {
      setError('Could not reload relay settings.');
    } finally {
      setBusy(false);
    }
  }

  function add() {
    setError('');
    try {
      const normalized = desktopRelayOrigin(origin.trim());
      if (profiles.some((profile) => profile.origin === normalized)) {
        setError('That relay origin is already listed.');
        return;
      }
      setProfiles([...profiles, { name: name.trim(), origin: normalized }]);
      setName('');
      setOrigin('');
    } catch {
      setError(
        'Use HTTPS or HTTP on localhost or a private IP address, without a path, credentials, query, or fragment.',
      );
    }
  }

  return (
    <section className="settings-section" aria-labelledby="desktop-relays-heading">
      <h2 id="desktop-relays-heading">Relay connections</h2>
      <p className="muted">
        Use relays on a trusted network. lpi has no application authentication.
      </p>
      {!saved && !error && <p role="status">Loading relay settings…</p>}
      {saved && !saved.editable && (
        <p className="muted">
          Development uses LPI_DESKTOP_SERVER. Edit saved profiles in the bundled desktop app.
        </p>
      )}
      <ul className="relay-settings-list">
        {profiles.map((profile, index) => {
          const active = inventory.find(({ relay }) => relay.client.origin === profile.origin);
          return (
            <li key={profile.origin}>
              <label>
                Relay name
                <input
                  value={profile.name}
                  maxLength={60}
                  disabled={!saved?.editable || busy}
                  onChange={(event) =>
                    setProfiles(
                      profiles.map((item, i) =>
                        i === index ? { ...item, name: event.target.value } : item,
                      ),
                    )
                  }
                />
              </label>
              <span className="relay-settings-origin">{profile.origin}</span>
              <span className="muted">
                {active
                  ? active.online
                    ? 'Connected'
                    : active.status === 'offline'
                      ? 'Offline'
                      : 'Connecting'
                  : 'Not applied'}
              </span>
              {saved?.editable && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || profiles.length === 1}
                  aria-label={`Remove ${profile.origin}`}
                  onClick={() =>
                    setProfiles(profiles.filter((item) => item.origin !== profile.origin))
                  }
                >
                  Remove
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {saved?.editable && (
        <>
          <form
            className="relay-settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            <label>
              New relay name
              <input
                value={name}
                maxLength={60}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Relay origin
              <input
                value={origin}
                maxLength={512}
                placeholder="https://relay.example"
                required
                onChange={(event) => setOrigin(event.target.value)}
              />
            </label>
            <Button
              className="relay-settings-add"
              type="submit"
              variant="outline"
              disabled={
                busy || !name.trim() || !origin.trim() || profiles.length >= MAX_RELAY_PROFILES
              }
            >
              Add relay
            </Button>
          </form>
          <div className="settings-scale-controls">
            <Button
              type="button"
              disabled={busy || !dirty || profiles.some(({ name }) => !name.trim())}
              onClick={() => void save()}
            >
              Save relay list
            </Button>
            {saved.needsReload && (
              <Button
                type="button"
                variant="outline"
                disabled={busy || dirty}
                onClick={() => void apply()}
              >
                Apply and reload
              </Button>
            )}
          </div>
          {saved.needsReload && (
            <p role="status">Saved. Apply the changes to reload the workspace.</p>
          )}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
