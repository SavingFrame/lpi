export const colors = {
  background: '#101115',
  panel: '#181a20',
  border: '#30333d',
  text: '#edf0f5',
  muted: '#a7adbb',
  accent: '#a5b4fc',
  selected: '#29324a',
  error: '#fca5a5',
  success: '#4ade80',
  running: '#93c5fd',
  blocked: '#fcd34d',
  unread: '#bef264',
} as const;

export function projectColor(id: string): string {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return ['#c4b5fd', '#67e8f9', '#f9a8d4', '#fdba74', '#a5b4fc', '#bef264'][hash % 6] ?? '#c4b5fd';
}
