export function relativeTime(value: string, now: number): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return '';
  }
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
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
