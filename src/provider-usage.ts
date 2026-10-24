import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { record } from './shared/client-state.js';
import type {
  ProviderUsage,
  UsageAccount,
  UsageSnapshot,
  UsageWindow,
} from './shared/provider-usage.js';

const CACHE_MS = 5 * 60_000;
const accounts = [
  { id: 'openai-codex', label: 'Codex' },
  { id: 'openai-codex-work', label: 'Work' },
] as const;

interface Credential {
  id: string;
  label: string;
  access: string;
  accountId: string;
  expires: number;
  identity: string;
  revision: string;
}
interface CachedUsage {
  identity: string;
  revision: string;
  nextFetch: number;
  failures: number;
  report: ProviderUsage;
}

function unavailable(message: string): ProviderUsage {
  return { provider: 'openai-codex', status: 'unavailable', fetchedAt: null, windows: [], message };
}

export function codexUsage(payload: unknown, fetchedAt: number): ProviderUsage {
  const limits = record(record(payload).rate_limit);
  const windows: UsageWindow[] = [];
  for (const [key, fallback] of [
    ['primary_window', 'Primary'],
    ['secondary_window', 'Secondary'],
  ] as const) {
    if (limits[key] == null) {
      continue;
    }
    const raw = record(limits[key]);
    if (
      typeof raw.used_percent !== 'number' ||
      !Number.isFinite(raw.used_percent) ||
      raw.used_percent < 0 ||
      raw.used_percent > 100 ||
      typeof raw.limit_window_seconds !== 'number' ||
      !Number.isSafeInteger(raw.limit_window_seconds) ||
      raw.limit_window_seconds <= 0 ||
      (raw.reset_at != null &&
        (typeof raw.reset_at !== 'number' ||
          !Number.isSafeInteger(raw.reset_at) ||
          raw.reset_at <= 0 ||
          raw.reset_at > 8.64e12))
    ) {
      throw new Error('Invalid quota window');
    }
    const seconds = raw.limit_window_seconds;
    windows.push({
      label:
        seconds % 604800 === 0
          ? `${seconds / 604800}w`
          : seconds % 3600 === 0
            ? `${seconds / 3600}h`
            : seconds % 60 === 0
              ? `${seconds / 60}m`
              : fallback,
      remainingPercent: 100 - raw.used_percent,
      resetsAt: typeof raw.reset_at === 'number' ? raw.reset_at * 1000 : null,
    });
  }
  if (!windows.length) {
    throw new Error('Missing quota windows');
  }
  return { provider: 'openai-codex', status: 'ready', fetchedAt, windows, message: null };
}

/** Read-only Pi credential consumer. Never invokes Pi auth APIs or writes credential files. */
export class ProviderUsageService {
  private readonly path: string;
  private readonly cache = new Map<string, CachedUsage>();
  private pending: Promise<UsageSnapshot> | undefined;
  private readonly requests = new Set<AbortController>();
  private closed = false;

  constructor(
    path = join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent'), 'auth.json'),
  ) {
    this.path = path;
  }

  close(): void {
    this.closed = true;
    for (const controller of this.requests) {
      controller.abort();
    }
  }

  get(): Promise<UsageSnapshot> {
    if (this.closed) {
      return Promise.resolve({ accounts: [], message: 'Usage service stopped.' });
    }
    this.pending ??= this.load().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async credentials(): Promise<Credential[]> {
    if ((await stat(this.path)).size > 1024 * 1024) {
      throw new Error('Credential file too large');
    }
    const raw = record(JSON.parse(await readFile(this.path, 'utf8')));
    const result: Credential[] = [];
    for (const { id, label } of accounts) {
      if (raw[id] === undefined) {
        continue;
      }
      const credential = record(raw[id]);
      if (
        credential.type !== 'oauth' ||
        typeof credential.access !== 'string' ||
        credential.access.length > 32_768 ||
        credential.access.split('.').length !== 3 ||
        typeof credential.expires !== 'number' ||
        !Number.isFinite(credential.expires)
      ) {
        throw new Error('Invalid Codex credentials');
      }
      const claims = record(
        JSON.parse(Buffer.from(credential.access.split('.')[1] ?? '', 'base64url').toString()),
      );
      const auth = record(claims['https://api.openai.com/auth']);
      const accountId = auth.chatgpt_account_id;
      if (
        typeof accountId !== 'string' ||
        !accountId ||
        accountId.length > 512 ||
        (credential.accountId !== undefined && credential.accountId !== accountId)
      ) {
        throw new Error('Invalid Codex account identity');
      }
      result.push({
        id,
        label,
        access: credential.access,
        accountId,
        expires:
          typeof claims.exp === 'number' && Number.isFinite(claims.exp)
            ? Math.min(credential.expires, claims.exp * 1000)
            : credential.expires,
        identity: createHash('sha256')
          .update(
            JSON.stringify([
              accountId,
              typeof claims.sub === 'string'
                ? claims.sub
                : typeof auth.chatgpt_user_id === 'string'
                  ? auth.chatgpt_user_id
                  : credential.access,
            ]),
          )
          .digest('hex'),
        revision: createHash('sha256').update(credential.access).digest('hex'),
      });
    }
    return result;
  }

  private stale(entry: CachedUsage, message: string): ProviderUsage {
    return entry.report.fetchedAt
      ? { ...entry.report, status: 'stale', message }
      : unavailable(message);
  }

  private async load(): Promise<UsageSnapshot> {
    let credentials: Credential[];
    try {
      credentials = await this.credentials();
    } catch {
      return {
        accounts: accounts.flatMap(({ id, label }) => {
          const entry = this.cache.get(id);
          return entry ? [{ id, label, ...this.stale(entry, 'Pi credentials unavailable.') }] : [];
        }),
        message: 'Pi credentials unavailable. Waiting for Pi to update auth.json.',
      };
    }
    const ids = new Set(credentials.map(({ id }) => id));
    for (const id of this.cache.keys()) {
      if (!ids.has(id)) {
        this.cache.delete(id);
      }
    }
    const reports = await Promise.all(credentials.map((credential) => this.query(credential)));
    return {
      accounts: reports,
      message: reports.length ? null : 'No Codex subscription accounts found in Pi.',
    };
  }

  private async query(credential: Credential): Promise<UsageAccount> {
    const { id, label } = credential;
    let entry = this.cache.get(id);
    if (!entry || entry.identity !== credential.identity) {
      entry = {
        identity: credential.identity,
        revision: credential.revision,
        nextFetch: 0,
        failures: 0,
        report: unavailable('No usage snapshot yet.'),
      };
      this.cache.set(id, entry);
    }
    const result = (report: ProviderUsage): UsageAccount => ({ id, label, ...report });
    if (entry.revision !== credential.revision) {
      entry.revision = credential.revision;
      entry.nextFetch = 0;
      entry.failures = 0;
    }
    if (credential.expires <= Date.now()) {
      return result(this.stale(entry, 'Pi credentials expired. Waiting for Pi to refresh them.'));
    }
    if (Date.now() < entry.nextFetch || this.closed) {
      return result(entry.report);
    }
    const controller = new AbortController();
    this.requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 10_000);
    timeout.unref();
    entry.nextFetch = Date.now() + CACHE_MS;
    try {
      const response = await fetch('https://chatgpt.com/backend-api/wham/usage', {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${credential.access}`,
          'ChatGPT-Account-ID': credential.accountId,
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) {
          const retry = response.headers.get('retry-after');
          const delay =
            retry && /^\d+$/.test(retry)
              ? Number(retry) * 1000
              : retry
                ? Date.parse(retry) - Date.now()
                : 0;
          entry.nextFetch = Date.now() + Math.max(CACHE_MS, Math.min(delay || 0, 86_400_000));
        }
        throw new Error('Usage request failed');
      }
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Empty usage response');
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          size += value.byteLength;
          if (size > 256 * 1024) {
            throw new Error('Usage response too large');
          }
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const report = codexUsage(JSON.parse(Buffer.concat(chunks).toString()), Date.now());
      const latest = (await this.credentials()).find((item) => item.id === id);
      if (
        controller.signal.aborted ||
        this.closed ||
        latest?.identity !== credential.identity ||
        latest.revision !== credential.revision ||
        latest.expires <= Date.now()
      ) {
        if (latest?.identity !== credential.identity) {
          this.cache.delete(id);
        } else {
          entry.nextFetch = 0;
        }
        return result(unavailable('Pi credentials changed. Waiting for the next update.'));
      }
      entry.report = report;
      entry.failures = 0;
    } catch {
      entry.failures++;
      entry.nextFetch = Math.max(
        entry.nextFetch,
        Date.now() + Math.min(CACHE_MS * 2 ** (entry.failures - 1), 3_600_000),
      );
      entry.report = this.stale(entry, 'Usage update failed. Waiting to retry.');
    } finally {
      clearTimeout(timeout);
      this.requests.delete(controller);
    }
    return result(entry.report);
  }
}
