import type { UsageAccount, UsageSnapshot, UsageWindow } from '../shared/provider-usage.ts';

export interface UsageState extends UsageSnapshot {
  online: boolean;
  loading: boolean;
}

/** Global, session-independent usage polling shared by browser and mobile adapters. */
export class UsageController {
  private current: UsageState = { accounts: [], message: null, online: false, loading: false };
  private readonly listeners = new Set<() => void>();
  private readonly fetchUsage: (signal: AbortSignal) => Promise<UsageSnapshot>;
  private request: AbortController | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(fetchUsage: (signal: AbortSignal) => Promise<UsageSnapshot>) {
    this.fetchUsage = fetchUsage;
  }

  getState = (): UsageState => this.current;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(state: UsageState): void {
    this.current = state;
    for (const listener of this.listeners) {
      listener();
    }
  }

  start = (): void => {
    if (this.timer) {
      return;
    }
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 60_000);
  };

  stop = (): void => {
    clearInterval(this.timer);
    this.timer = undefined;
    this.request?.abort();
    this.request = undefined;
    this.update({ ...this.current, online: false, loading: false });
  };

  refresh = async (): Promise<void> => {
    if (this.request) {
      return;
    }
    const controller = new AbortController();
    this.request = controller;
    this.update({ ...this.current, loading: true });
    try {
      const snapshot = await this.fetchUsage(controller.signal);
      if (this.request === controller) {
        this.update({ ...snapshot, online: true, loading: false });
      }
    } catch {
      if (this.request === controller) {
        this.update({
          ...this.current,
          online: false,
          loading: false,
          message: 'Usage unavailable. Showing last-known data.',
        });
      }
    } finally {
      if (this.request === controller) {
        this.request = undefined;
      }
    }
  };
}

export function usagePresentation(
  account: UsageAccount,
  online: boolean,
  now: number,
): {
  outdated: boolean;
  used: number | null;
  windows: { label: string; usedPercent: number; resetsAt: number | null }[];
  tone: 'muted' | 'normal' | 'low' | 'critical';
  compact: string;
  rings: {
    label: string;
    usedPercent: number | null;
    tone: 'muted' | 'short' | 'long' | 'low' | 'critical';
  }[];
} {
  const outdated =
    !online ||
    account.status !== 'ready' ||
    now - (account.fetchedAt ?? 0) >= 5 * 60_000 ||
    account.windows.some((window) => window.resetsAt !== null && window.resetsAt <= now);
  const windows = account.windows.map((window) => ({
    label: window.label,
    usedPercent: 100 - window.remainingPercent,
    resetsAt: window.resetsAt,
  }));
  const used = windows.length ? Math.max(...windows.map((window) => window.usedPercent)) : null;
  const tone =
    outdated || used === null ? 'muted' : used >= 95 ? 'critical' : used >= 80 ? 'low' : 'normal';
  const rings: { label: string; usedPercent: number | null }[] = [
    { label: 'Short window', usedPercent: null },
    { label: 'Long window', usedPercent: null },
  ];
  for (const window of windows) {
    const match = /^(\d+)(m|h|w)$/.exec(window.label);
    const seconds = match
      ? Number(match[1]) * (match[2] === 'w' ? 604800 : match[2] === 'h' ? 3600 : 60)
      : 0;
    const index = window.label === 'Secondary' || seconds >= 86400 ? 1 : 0;
    rings[index] = { label: window.label, usedPercent: window.usedPercent };
  }
  return {
    outdated,
    used,
    windows,
    tone,
    rings: rings.map((ring, index) => ({
      ...ring,
      tone:
        outdated || ring.usedPercent === null
          ? 'muted'
          : ring.usedPercent >= 95
            ? 'critical'
            : ring.usedPercent >= 80
              ? 'low'
              : index === 0
                ? 'short'
                : 'long',
    })),
    compact: `${account.label} ${used === null ? 'unavailable' : `${Number(used.toFixed(1))}% used`}${outdated ? ' · outdated' : used === 100 ? ' · allowance exhausted' : ''}`,
  };
}

export function resetLabel(window: Pick<UsageWindow, 'resetsAt'>, now: number): string {
  if (window.resetsAt === null) {
    return 'Reset time unavailable';
  }
  if (window.resetsAt <= now) {
    return 'Awaiting reset update';
  }
  const minutes = Math.ceil((window.resetsAt - now) / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  return `Resets in ${days ? `${days}d ${hours % 24}h` : hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`}`;
}
