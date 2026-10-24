import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  resetLabel,
  UsageController,
  usagePresentation,
} from '../dist/src/client/provider-usage.js';
import { codexUsage, ProviderUsageService } from '../dist/src/provider-usage.js';
import { usageSnapshot } from '../dist/src/shared/provider-usage.js';

const epoch = 2_000_000_000_000;
const payload = {
  rate_limit: {
    primary_window: { used_percent: 23, limit_window_seconds: 18000, reset_at: 2_000_018_000 },
    secondary_window: { used_percent: 80, limit_window_seconds: 604800, reset_at: 2_000_604_800 },
  },
  secret: 'raw backend data must not leave the server',
};
function credential(accountId, expires = epoch + 3_600_000, revision = '') {
  const claims = {
    sub: `user:${accountId}`,
    'https://api.openai.com/auth': { chatgpt_account_id: accountId },
    revision,
  };
  return {
    type: 'oauth',
    access: `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`,
    refresh: 'never-use-refresh',
    expires,
    accountId,
  };
}
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'lpi-usage-'));
  const path = join(directory, 'auth.json');
  const auth = {
    'openai-codex': credential('personal-id'),
    'openai-codex-work': credential('work-id'),
    unrelated: credential('ignored-id'),
  };
  const save = () => writeFileSync(path, JSON.stringify(auth));
  save();
  let now = epoch;
  t.mock.method(Date, 'now', () => now);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url, init });
    return Response.json(payload);
  });
  const service = new ProviderUsageService(path);
  t.after(() => {
    service.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    service,
    auth,
    save,
    path,
    requests,
    advance: (ms) => {
      now += ms;
    },
  };
}

test('normalization and the wire contract expose only validated quota metadata', () => {
  const report = codexUsage(payload, epoch);
  assert.deepEqual(
    report.windows.map((window) => window.remainingPercent),
    [77, 20],
  );
  assert.deepEqual(
    report.windows.map((window) => window.label),
    ['5h', '1w'],
  );
  const snapshot = usageSnapshot({
    accounts: [{ id: 'openai-codex', label: 'Codex', ...report, access: 'secret' }],
    message: null,
  });
  assert.equal(JSON.stringify(snapshot).includes('secret'), false);
  assert.throws(() => codexUsage({ rate_limit: {} }, epoch));
  assert.throws(() =>
    usageSnapshot({
      accounts: [
        { ...snapshot.accounts[0], windows: [{ ...report.windows[0], remainingPercent: -1 }] },
      ],
      message: null,
    }),
  );
  assert.throws(() =>
    usageSnapshot({ accounts: [snapshot.accounts[0], snapshot.accounts[0]], message: null }),
  );
});

test('reads both Pi accounts without writing or refreshing credentials and shares the cache across callers', async (t) => {
  const f = fixture(t);
  const before = readFileSync(f.path, 'utf8');
  const pending = f.service.get();
  assert.equal(f.service.get(), pending);
  const snapshot = await pending;
  assert.deepEqual(
    snapshot.accounts.map((account) => account.label),
    ['Codex', 'Work'],
  );
  assert.equal(f.requests.length, 2);
  assert.equal(readFileSync(f.path, 'utf8'), before);
  for (const { url, init } of f.requests) {
    assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.ok(['personal-id', 'work-id'].includes(init.headers['ChatGPT-Account-ID']));
  }
  assert.equal(
    /personal-id|work-id|never-use-refresh|header\.|raw backend/.test(JSON.stringify(snapshot)),
    false,
  );
  await f.service.get();
  assert.equal(f.requests.length, 2);
  f.advance(300_000);
  await f.service.get();
  assert.equal(f.requests.length, 4);
});

test('expired and rejected credentials retain outdated data; Pi token updates resume reads', async (t) => {
  const f = fixture(t);
  const initial = await f.service.get();
  f.auth['openai-codex'].expires = epoch - 1;
  f.save();
  const expired = await f.service.get();
  assert.equal(f.requests.length, 2);
  assert.equal(expired.accounts[0].status, 'stale');
  assert.equal(expired.accounts[0].fetchedAt, initial.accounts[0].fetchedAt);
  assert.match(expired.accounts[0].message, /expired/);
  f.auth['openai-codex'] = credential('personal-id', epoch + 3_600_000, 'updated-by-pi');
  f.save();
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('secret backend error', { status: 401 }),
  );
  const rejected = await f.service.get();
  assert.equal(rejected.accounts[0].status, 'stale');
  assert.equal(JSON.stringify(rejected).includes('secret'), false);
  assert.equal(readFileSync(f.path, 'utf8'), JSON.stringify(f.auth));
});

test('new account identities never inherit cached quotas and invalid identity is never sent', async (t) => {
  const f = fixture(t);
  await f.service.get();
  f.auth['openai-codex'] = credential('replacement-id');
  f.save();
  t.mock.method(globalThis, 'fetch', async () => new Response('failure', { status: 503 }));
  const replaced = await f.service.get();
  assert.equal(replaced.accounts[0].status, 'unavailable');
  assert.deepEqual(replaced.accounts[0].windows, []);
  f.auth['openai-codex'].accountId = 'mismatched';
  f.save();
  let invalidRequests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    invalidRequests++;
    return Response.json(payload);
  });
  await f.service.get();
  assert.equal(invalidRequests, 0);
  assert.equal(f.requests.length, 2);
});

test('rate limits back off independently, preserving successful results for the other account', async (t) => {
  const f = fixture(t);
  await f.service.get();
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    f.requests.push({ init });
    return init.headers['ChatGPT-Account-ID'] === 'personal-id'
      ? new Response('private', { status: 429, headers: { 'retry-after': '900' } })
      : Response.json(payload);
  });
  f.advance(300_000);
  const result = await f.service.get();
  assert.equal(result.accounts[0].status, 'stale');
  assert.equal(result.accounts[1].status, 'ready');
  f.advance(300_000);
  await f.service.get();
  assert.equal(
    f.requests.filter(({ init }) => init.headers['ChatGPT-Account-ID'] === 'personal-id').length,
    2,
  );
  f.advance(600_000);
  await f.service.get();
  assert.equal(
    f.requests.filter(({ init }) => init.headers['ChatGPT-Account-ID'] === 'personal-id').length,
    3,
  );
});

test('missing credentials keep only stale snapshots; removed accounts disappear on a valid read', async (t) => {
  const f = fixture(t);
  await f.service.get();
  writeFileSync(f.path, '{');
  const broken = await f.service.get();
  assert.equal(broken.accounts.length, 2);
  assert.ok(broken.accounts.every((account) => account.status === 'stale'));
  delete f.auth['openai-codex-work'];
  f.save();
  const removed = await f.service.get();
  assert.equal(removed.accounts.length, 1);
  assert.equal(removed.accounts[0].id, 'openai-codex');
});

test('oversized responses are rejected and in-flight account changes cannot publish an old result', async (t) => {
  const f = fixture(t);
  t.mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(256 * 1024 + 1)));
  assert.ok((await f.service.get()).accounts.every((account) => account.status === 'unavailable'));
  f.advance(300_000);
  t.mock.method(globalThis, 'fetch', async () => {
    f.auth['openai-codex'] = credential('new-identity');
    f.save();
    return Response.json(payload);
  });
  const changed = await f.service.get();
  assert.equal(changed.accounts[0].status, 'unavailable');
  assert.deepEqual(changed.accounts[0].windows, []);
});

test('client polling preserves stale data on transport failure and ignores completion after stop', async () => {
  const snapshot = {
    accounts: [{ id: 'openai-codex', label: 'Codex', ...codexUsage(payload, epoch) }],
    message: null,
  };
  let fail = false;
  const controller = new UsageController(async () => {
    if (fail) {
      throw new Error('offline');
    }
    return snapshot;
  });
  await controller.refresh();
  fail = true;
  await controller.refresh();
  const state = controller.getState();
  assert.equal(state.online, false);
  assert.deepEqual(state.accounts, snapshot.accounts);
  let finish;
  const late = new UsageController(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = late.refresh();
  late.stop();
  finish(snapshot);
  await pending;
  assert.deepEqual(late.getState().accounts, []);
});

test('both platforms show used allowance with warning thresholds and muted outdated state', () => {
  const account = { id: 'openai-codex', label: 'Codex', ...codexUsage(payload, epoch) };
  const view = usagePresentation(account, true, epoch);
  assert.equal(view.tone, 'low');
  assert.equal(view.used, 80);
  assert.match(view.compact, /80% used/);
  assert.deepEqual(
    view.windows.map((window) => window.usedPercent),
    [23, 80],
  );
  assert.deepEqual(
    view.rings.map(({ label, usedPercent, tone }) => ({ label, usedPercent, tone })),
    [
      { label: '5h', usedPercent: 23, tone: 'short' },
      { label: '1w', usedPercent: 80, tone: 'low' },
    ],
  );
  const weeklyOnly = usagePresentation({ ...account, windows: [account.windows[1]] }, true, epoch);
  assert.equal(weeklyOnly.rings[0].usedPercent, null);
  assert.equal(weeklyOnly.rings[1].usedPercent, 80);
  account.windows[0].remainingPercent = 5;
  const critical = usagePresentation(account, true, epoch);
  assert.equal(critical.used, 95);
  assert.equal(critical.tone, 'critical');
  assert.equal(critical.rings[0].tone, 'critical');
  account.windows[0].remainingPercent = 0;
  const exhausted = usagePresentation(account, true, epoch);
  assert.equal(exhausted.rings[0].usedPercent, 100);
  assert.equal(exhausted.tone, 'critical');
  assert.match(exhausted.compact, /100% used · allowance exhausted/);
  const offline = usagePresentation(account, false, epoch);
  assert.equal(offline.tone, 'muted');
  assert.ok(offline.rings.every((ring) => ring.tone === 'muted'));
  assert.equal(usagePresentation(account, true, epoch + 300_000).outdated, true);
  assert.equal(
    resetLabel({ ...account.windows[0], resetsAt: epoch }, epoch),
    'Awaiting reset update',
  );
});
