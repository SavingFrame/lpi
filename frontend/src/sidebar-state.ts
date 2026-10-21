export function projectColor(id: string): string {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return ['#c4b5fd', '#67e8f9', '#f9a8d4', '#fdba74', '#a5b4fc', '#bef264'][hash % 6] ?? '#c4b5fd';
}

export function relativeTime(value: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000));
  if (minutes < 1) {
    return 'now';
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  if (minutes < 1440) {
    return `${Math.floor(minutes / 60)}h`;
  }
  return `${Math.floor(minutes / 1440)}d`;
}
