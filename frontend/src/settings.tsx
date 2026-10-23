import { useEffect, useState } from 'react';
import { live } from './client';
import { Button } from './components/ui/button';
import { type DesktopPlatform, desktop } from './platform';

function DesktopAppearance({ platform }: { platform: DesktopPlatform }) {
  const [factor, setFactor] = useState<number>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let changed = false;
    const unsubscribe = platform.onZoomChanged((value) => {
      changed = true;
      if (active) {
        setFactor(value);
      }
    });
    void platform.getZoom().then(
      (value) => {
        if (active && !changed) {
          setFactor(value);
        }
      },
      () => {
        if (active) {
          setError('Could not load UI scale. Reload the app to try again.');
        }
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [platform]);

  async function change(value: number) {
    setPending(true);
    setError('');
    try {
      await platform.setZoom(value);
    } catch {
      setError('Could not save UI scale. Check desktop profile permissions and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="settings-section" aria-labelledby="appearance-heading">
      <h2 id="appearance-heading">Appearance</h2>
      <label htmlFor="desktop-scale">UI scale</label>
      <p className="muted" id="desktop-scale-help">
        Resize the entire app, including text, buttons, and the sidebar. Saved on this device.
      </p>
      <div className="settings-scale-controls">
        <select
          id="desktop-scale"
          aria-describedby="desktop-scale-help"
          value={factor === undefined ? '' : Math.round(factor * 100)}
          disabled={factor === undefined || pending}
          onChange={(event) => void change(Number(event.target.value) / 100)}
        >
          {factor === undefined && <option value="">Loading…</option>}
          {Array.from({ length: 26 }, (_, index) => 75 + index * 5).map((percent) => (
            <option key={percent} value={percent}>
              {percent}%
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          disabled={factor === undefined || factor === 1 || pending}
          onClick={() => void change(1)}
        >
          Reset to 100%
        </Button>
      </div>
      <p className="muted">Use Ctrl/Cmd + Plus or Minus to zoom, and Ctrl/Cmd + 0 to reset.</p>
      {pending && <p role="status">Saving…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function SettingsPage() {
  useEffect(() => live.select(null), []);
  return (
    <div className="settings-page">
      <h1>Settings</h1>
      {desktop ? (
        <DesktopAppearance platform={desktop} />
      ) : (
        <p className="muted">
          UI scale is available in the desktop app. In a browser, use browser zoom.
        </p>
      )}
    </div>
  );
}
