import { record } from './client-state.ts';

export interface UsageWindow {
  label: string;
  remainingPercent: number;
  resetsAt: number | null;
}

export interface UsageAccount extends ProviderUsage {
  id: string;
  label: string;
}

export interface UsageSnapshot {
  accounts: UsageAccount[];
  message: string | null;
}

export function usageSnapshot(value: unknown): UsageSnapshot {
  const raw = record(value);
  if (
    !Array.isArray(raw.accounts) ||
    raw.accounts.length > 2 ||
    (raw.message !== null && (typeof raw.message !== 'string' || raw.message.length > 200))
  ) {
    throw new Error('Invalid usage snapshot');
  }
  const ids = new Set<string>();
  const accounts = raw.accounts.map((value: unknown): UsageAccount => {
    const account = record(value);
    const report = providerUsage(account);
    if (
      !report ||
      typeof account.id !== 'string' ||
      !['openai-codex', 'openai-codex-work'].includes(account.id) ||
      ids.has(account.id) ||
      typeof account.label !== 'string' ||
      !account.label ||
      account.label.length > 40
    ) {
      throw new Error('Invalid usage account');
    }
    ids.add(account.id);
    return { id: account.id, label: account.label, ...report };
  });
  return { accounts, message: raw.message };
}

/** Read-only quota metadata. Never contains credential identities, tokens, or raw responses. */
export interface ProviderUsage {
  provider: 'openai-codex';
  status: 'loading' | 'ready' | 'stale' | 'unavailable';
  fetchedAt: number | null;
  windows: UsageWindow[];
  message: string | null;
}

export function providerUsage(value: unknown): ProviderUsage | null {
  if (value === undefined || value === null) {
    return null;
  }
  const raw = record(value);
  if (
    raw.provider !== 'openai-codex' ||
    !['loading', 'ready', 'stale', 'unavailable'].includes(String(raw.status)) ||
    (raw.fetchedAt !== null &&
      (typeof raw.fetchedAt !== 'number' ||
        !Number.isFinite(raw.fetchedAt) ||
        raw.fetchedAt <= 0)) ||
    (raw.message !== null && (typeof raw.message !== 'string' || raw.message.length > 200)) ||
    !Array.isArray(raw.windows) ||
    raw.windows.length > 2
  ) {
    throw new Error('Invalid provider usage');
  }
  const windows = raw.windows.map((value: unknown): UsageWindow => {
    const window = record(value);
    if (
      typeof window.label !== 'string' ||
      !window.label ||
      window.label.length > 40 ||
      typeof window.remainingPercent !== 'number' ||
      !Number.isFinite(window.remainingPercent) ||
      window.remainingPercent < 0 ||
      window.remainingPercent > 100 ||
      (window.resetsAt !== null &&
        (typeof window.resetsAt !== 'number' ||
          !Number.isFinite(window.resetsAt) ||
          window.resetsAt <= 0 ||
          window.resetsAt > 8.64e15))
    ) {
      throw new Error('Invalid provider usage window');
    }
    return {
      label: window.label,
      remainingPercent: window.remainingPercent,
      resetsAt: window.resetsAt,
    };
  });
  if (
    raw.status === 'ready' || raw.status === 'stale'
      ? !windows.length || raw.fetchedAt === null
      : windows.length !== 0 || raw.fetchedAt !== null
  ) {
    throw new Error('Invalid provider usage state');
  }
  return {
    provider: 'openai-codex',
    status: raw.status as ProviderUsage['status'],
    fetchedAt: raw.fetchedAt,
    windows,
    message: raw.message,
  };
}
