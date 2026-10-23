import { useState } from 'react';
import { Button } from '../components/ui/button';
import { useKeyboard } from './keyboard';
import { type ActionId, actions, defaults, shortcut } from './shortcuts';

export function KeyboardSettings() {
  const { bindings, save } = useKeyboard();
  const [search, setSearch] = useState('');
  const [recording, setRecording] = useState<ActionId | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="settings-section" aria-labelledby="keyboard-heading">
      <h2 id="keyboard-heading">Keyboard</h2>
      <p className="muted">
        Saved on this device. Shortcuts use the exact modifiers shown. Shift+Tab cycles thinking
        only in the composer. Elsewhere it moves focus backward.
      </p>
      <label className="keyboard-setting">
        Enter behavior
        <select
          value={
            bindings.send === 'Enter' && bindings.newline === 'Shift+Enter'
              ? 'send'
              : bindings.newline === 'Enter' && bindings.send === 'Shift+Enter'
                ? 'newline'
                : 'custom'
          }
          onChange={(event) => {
            const newline = event.target.value === 'newline';
            setError(
              save({
                ...bindings,
                send: newline ? 'Shift+Enter' : 'Enter',
                newline: newline ? 'Enter' : 'Shift+Enter',
              }),
            );
          }}
        >
          <option value="send">Enter sends, Shift+Enter newline</option>
          <option value="newline">Enter newline, Shift+Enter sends</option>
          <option value="custom" disabled>
            Custom shortcuts
          </option>
        </select>
      </label>
      <label className="keyboard-setting">
        Search shortcuts
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <p className="muted">
        Select a shortcut, then press the new combination. Escape cancels recording. Clear a
        conflicting assignment before reusing its keys.
      </p>
      <div className="shortcut-list">
        {actions
          .filter((action) => action.label.toLowerCase().includes(search.toLowerCase()))
          .map((action) => (
            <div key={action.id} className="shortcut-row">
              <span>{action.label}</span>
              <Button
                variant="outline"
                data-shortcut-recorder
                aria-label={`Change ${action.label} shortcut`}
                onClick={() => {
                  setRecording(action.id);
                  setError(null);
                }}
                onBlur={() => setRecording(null)}
                onKeyDown={(event) => {
                  if (recording !== action.id) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  if (
                    event.nativeEvent.isComposing ||
                    event.nativeEvent.keyCode === 229 ||
                    event.repeat
                  ) {
                    return;
                  }
                  if (event.key === 'Escape') {
                    setRecording(null);
                    return;
                  }
                  const key = shortcut(event);
                  if (!key) {
                    return;
                  }
                  const message = save({ ...bindings, [action.id]: key });
                  setError(message);
                  if (!message) {
                    setRecording(null);
                  }
                }}
              >
                {recording === action.id ? 'Press keys…' : bindings[action.id] || 'Unassigned'}
              </Button>
              <Button
                variant="ghost"
                disabled={!bindings[action.id]}
                aria-label={`Clear ${action.label} shortcut`}
                onClick={() => setError(save({ ...bindings, [action.id]: '' }))}
              >
                Clear
              </Button>
            </div>
          ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Button
        variant="outline"
        onClick={() => {
          setRecording(null);
          setError(save({ ...defaults }));
        }}
      >
        Restore keyboard defaults
      </Button>
    </section>
  );
}
