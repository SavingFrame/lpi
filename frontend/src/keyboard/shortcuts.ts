export const actions = [
  { id: 'left', label: 'Focus left pane', key: 'Ctrl+h' },
  { id: 'right', label: 'Focus right pane', key: 'Ctrl+l' },
  { id: 'composer', label: 'Focus message composer', key: 'Ctrl+i' },
  { id: 'new', label: 'New session', key: 'Ctrl+n' },
  { id: 'search', label: 'Search sessions', key: 'Ctrl+k' },
  { id: 'palette', label: 'Open command palette', key: 'Ctrl+Shift+p' },
  { id: 'thinking', label: 'Cycle thinking level', key: 'Shift+Tab' },
  { id: 'abort', label: 'Stop generation', key: 'Escape' },
  { id: 'previous', label: 'Previous session', key: 'Ctrl+Shift+ArrowUp' },
  { id: 'next', label: 'Next session', key: 'Ctrl+Shift+ArrowDown' },
  { id: 'settings', label: 'Open settings', key: 'Ctrl+,' },
  { id: 'send', label: 'Send message', key: 'Enter' },
  { id: 'newline', label: 'Insert newline', key: 'Shift+Enter' },
] as const;

export type ActionId = (typeof actions)[number]['id'];
export type Bindings = Record<ActionId, string>;
export const defaults = Object.fromEntries(actions.map(({ id, key }) => [id, key])) as Bindings;

interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function shortcut(event: KeyInput): string | null {
  if (['Control', 'Meta', 'Alt', 'Shift', 'Dead', 'Process', 'Unidentified'].includes(event.key)) {
    return null;
  }
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return [
    event.ctrlKey ? 'Ctrl' : '',
    event.metaKey ? 'Meta' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    key === ' ' ? 'Space' : key,
  ]
    .filter(Boolean)
    .join('+');
}

export function bindingError(bindings: Bindings): string | null {
  const seen = new Map<string, string>();
  for (const action of actions) {
    const key = bindings[action.id];
    if (!key) {
      continue;
    }
    if (/^(Ctrl|Meta)\+(Shift\+)?[+=\-0]$/.test(key)) {
      return `${key} is reserved for UI scale.`;
    }
    if (key === 'Tab' || (key === 'Enter' && !['send', 'newline'].includes(action.id))) {
      return `${key} is reserved for navigation or message entry.`;
    }
    if (!key.includes('+') && !['Enter', 'Escape'].includes(key) && !/^F\d{1,2}$/.test(key)) {
      return 'Use a modifier key to avoid overriding normal typing.';
    }
    const previous = seen.get(key);
    if (previous) {
      return `${key} is already assigned to ${previous}.`;
    }
    seen.set(key, action.label);
  }
  return null;
}

export function parseBindings(value: unknown): Bindings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...defaults };
  }
  const record = value as Record<string, unknown>;
  const result = { ...defaults };
  for (const { id } of actions) {
    if (typeof record[id] !== 'string' || record[id].length > 80) {
      return { ...defaults };
    }
    result[id] = record[id];
  }
  return bindingError(result) ? { ...defaults } : result;
}
