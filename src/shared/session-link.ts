/** Notification links only select history on the device's configured relay. Never launch Pi. */
export function linkedSessionId(value: unknown): string | null {
  return typeof value === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
    ? value
    : null;
}

export function sessionLink(id: string): string {
  if (!linkedSessionId(id)) {
    throw new Error('Invalid session link ID');
  }
  return `pim:///?session=${id}`;
}
