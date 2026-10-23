import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Button } from '../components/ui/button';
import {
  type ActionId,
  actions,
  type Bindings,
  bindingError,
  defaults,
  parseBindings,
  shortcut,
} from './shortcuts';

const storageKey = 'pim:keyboard:v1';
type Handler = () => void;
interface KeyboardState {
  bindings: Bindings;
  save: (bindings: Bindings) => string | null;
  register: (id: ActionId, handler: Handler) => () => void;
}
const KeyboardContext = createContext<KeyboardState | null>(null);

export function useKeyboard() {
  const context = useContext(KeyboardContext);
  if (!context) {
    throw new Error('KeyboardProvider is missing');
  }
  return context;
}

export function useKeyboardAction(id: ActionId, handler: Handler, enabled = true) {
  const { register } = useKeyboard();
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (enabled) {
      return register(id, () => latest.current());
    }
  }, [register, id, enabled]);
}

export function KeyboardProvider({ children }: { children: ReactNode }) {
  const [bindings, setBindings] = useState(() => {
    try {
      return parseBindings(JSON.parse(localStorage.getItem(storageKey) ?? 'null'));
    } catch {
      return { ...defaults };
    }
  });
  const handlers = useRef(new Map<ActionId, Handler>());
  const [available, setAvailable] = useState<ActionId[]>([]);
  const register = useCallback((id: ActionId, handler: Handler) => {
    handlers.current.set(id, handler);
    setAvailable([...handlers.current.keys()]);
    return () => {
      if (handlers.current.get(id) === handler) {
        handlers.current.delete(id);
        setAvailable([...handlers.current.keys()]);
      }
    };
  }, []);
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const matches = actions.filter(
    (action) =>
      action.id !== 'palette' &&
      action.id !== 'newline' &&
      action.label.toLowerCase().includes(query.toLowerCase()),
  );
  const highlighted = Math.min(selected, Math.max(0, matches.length - 1));
  const highlightedId = matches[highlighted]?.id;
  useEffect(() => {
    if (dialog.current?.open) {
      document.getElementById(`palette-${highlightedId}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedId]);
  const openPalette = useCallback(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setSelected(0);
    dialog.current?.showModal();
    dialog.current?.querySelector('input')?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        document.querySelector('dialog[open]') ||
        (event.target instanceof Element && event.target.closest('[data-shortcut-recorder]'))
      ) {
        return;
      }
      const key = shortcut(event);
      const action = actions.find(({ id }) => bindings[id] && bindings[id] === key);
      if (!action || ['send', 'newline'].includes(action.id)) {
        return;
      }
      // Shift+Tab only replaces reverse Tab navigation in the message composer.
      if (
        action.id === 'thinking' &&
        !(event.target instanceof Element && event.target.matches('[data-message-composer]'))
      ) {
        return;
      }
      const handler = action.id === 'palette' ? openPalette : handlers.current.get(action.id);
      if (!handler) {
        return;
      }
      event.preventDefault();
      if (!event.repeat) {
        handler();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bindings, openPalette]);
  function run(id: ActionId) {
    dialog.current?.close();
    // Restore the old pane before executing an action that may deliberately move focus.
    previousFocus.current?.focus({ preventScroll: true });
    handlers.current.get(id)?.();
  }
  return (
    <KeyboardContext.Provider
      value={{
        bindings,
        register,
        save: (next) => {
          const error = bindingError(next);
          if (error) {
            return error;
          }
          try {
            localStorage.setItem(storageKey, JSON.stringify(next));
          } catch {
            return 'Could not save keyboard settings. Check device storage permissions.';
          }
          setBindings(next);
          return null;
        },
      }}
    >
      {children}
      <dialog
        ref={dialog}
        className="keyboard-dialog"
        aria-labelledby="palette-heading"
        onCancel={() => previousFocus.current?.focus({ preventScroll: true })}
      >
        <div className="keyboard-dialog-heading">
          <h2 id="palette-heading">Command palette</h2>
          <Button
            variant="ghost"
            onClick={() => {
              dialog.current?.close();
              previousFocus.current?.focus();
            }}
          >
            Close
          </Button>
        </div>
        <input
          aria-label="Search commands"
          placeholder="Search commands…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
              return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setSelected(
                (highlighted + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) %
                  Math.max(1, matches.length),
              );
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const item = matches[highlighted];
              if (item && available.includes(item.id)) {
                run(item.id);
              }
            }
          }}
          aria-controls="palette-results"
          aria-activedescendant={matches.length ? `palette-${matches[highlighted]?.id}` : undefined}
        />
        <ul id="palette-results" className="palette-results">
          {matches.map((action, index) => (
            <li
              key={action.id}
              id={`palette-${action.id}`}
              data-highlighted={index === highlighted}
            >
              <button
                type="button"
                disabled={!available.includes(action.id)}
                onClick={() => run(action.id)}
              >
                <span>{action.label}</span>
                <kbd>{bindings[action.id] || 'Unassigned'}</kbd>
              </button>
            </li>
          ))}
        </ul>
        {!matches.length && <p className="muted">No matching commands</p>}
      </dialog>
    </KeyboardContext.Provider>
  );
}
