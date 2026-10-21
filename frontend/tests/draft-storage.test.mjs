import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { SessionDrafts } from '../../src/client/drafts.ts';
import { clientStorageKey } from '../../src/client/storage.ts';

const id = 'session';
const image = { type: 'image', mimeType: 'image/png', data: btoa('\x89PNG\r\n\x1a\nimage') };
const key = clientStorageKey('relay-one', 'draft', id);

function setup(persistImages = true) {
  const values = new Map();
  const storage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
  const registry = new SessionDrafts({ server: 'relay-one', storage, persistImages });
  return { registry, storage, values, draft: registry.get(id) };
}

test('hydration restores text/images without sending and saved drafts beat branch suggestions', async () => {
  const { draft, values } = setup();
  values.set(key, JSON.stringify({ text: 'Unsent', images: [image] }));
  draft.restore({ text: 'Selected branch', images: [] });
  const loading = draft.initialize();
  assert.equal(draft.getState().loading, true);
  await loading;
  assert.deepEqual(draft.getState().draft, { text: 'Unsent', images: [image] });
  await draft.flush();
  assert.deepEqual(JSON.parse(values.get(key)), { text: 'Unsent', images: [image] });
});

test('delayed hydration preserves newer edits, including intentional deletion', async () => {
  for (const text of ['Typed before storage loaded', '']) {
    const { draft, storage, values } = setup();
    const read = Promise.withResolvers();
    storage.getItem = () => read.promise;
    const loading = draft.initialize();
    draft.restore({ text: 'Branch suggestion before the edit', images: [] });
    draft.update(() => ({ text, images: [] }));
    read.resolve(JSON.stringify({ text: 'Old saved draft', images: [image] }));
    await loading;
    await draft.flush();
    assert.deepEqual(draft.getState().draft, { text, images: [] });
    assert.deepEqual(JSON.parse(values.get(key)), { text, images: [] });
  }
});

test('remounts use the latest draft so a late acceptance preserves newer edits', async () => {
  const { registry, draft, values } = setup();
  await draft.initialize();
  draft.update(() => ({ text: 'Submitted', images: [image] }));
  const submitted = draft.getState().draft;
  const remounted = registry.get(id);
  assert.equal(remounted, draft);
  remounted.update(() => ({ text: 'New question', images: [] }));
  draft.settle(submitted, false);
  assert.deepEqual(remounted.getState().draft, { text: 'New question', images: [] });
  draft.settle(submitted, true);
  await draft.flush();
  assert.deepEqual(JSON.parse(values.get(key)), { text: 'New question', images: [] });
});

test('async persistence finishes in edit order and accepted content is cleared durably', async () => {
  const { draft, storage, values } = setup();
  const write = Promise.withResolvers();
  const save = storage.setItem;
  let calls = 0;
  storage.setItem = async (...args) => {
    if (++calls === 1) {
      await write.promise;
    }
    await save(...args);
  };
  await draft.initialize();
  draft.update(() => ({ text: 'Submitted', images: [image] }));
  const submitted = draft.getState().draft;
  draft.settle(submitted, true);
  await setImmediate();
  assert.equal(draft.getState().saving, true);
  write.resolve();
  await draft.flush();
  assert.equal(calls, 2);
  assert.equal(draft.getState().saving, false);
  assert.deepEqual(JSON.parse(values.get(key)), { text: '', images: [] });
});

test('storage failures keep edits in memory and retry reads before overwriting saved content', async () => {
  const { draft, storage, values } = setup();
  const read = storage.getItem;
  storage.getItem = async () => {
    throw new Error('Read unavailable');
  };
  await draft.initialize();
  assert.equal(draft.getState().error.message, 'Read unavailable');
  draft.update(() => ({ text: 'Keep this', images: [image] }));
  assert.equal(values.size, 0);
  storage.getItem = read;
  const write = storage.setItem;
  storage.setItem = async () => {
    throw new Error('Write unavailable');
  };
  await draft.retry();
  await draft.flush();
  assert.equal(draft.getState().error.message, 'Write unavailable');
  assert.deepEqual(draft.getState().draft, { text: 'Keep this', images: [image] });
  storage.setItem = write;
  await draft.retry();
  assert.equal(draft.getState().error, null);
  assert.deepEqual(JSON.parse(values.get(key)), { text: 'Keep this', images: [image] });
});

test('corrupt saved drafts are reported and never automatically overwritten', async () => {
  const { draft, values } = setup();
  values.set(key, '{invalid');
  await draft.initialize();
  assert.ok(draft.getState().error);
  assert.equal(values.get(key), '{invalid');
  assert.deepEqual(draft.getState().draft, { text: '', images: [] });
});

test('server switching isolates drafts and late acceptance from another relay', async () => {
  const { draft, storage, values } = setup();
  const other = new SessionDrafts({ server: 'relay-two', storage, persistImages: true }).get(id);
  await Promise.all([draft.initialize(), other.initialize()]);
  draft.update(() => ({ text: 'Relay one', images: [] }));
  const submitted = draft.getState().draft;
  other.update(() => ({ text: 'Relay two', images: [image] }));
  draft.settle(submitted, true);
  await Promise.all([draft.flush(), other.flush()]);
  assert.equal(JSON.parse(values.get(key)).text, '');
  assert.deepEqual(JSON.parse(values.get(clientStorageKey('relay-two', 'draft', id))), {
    text: 'Relay two',
    images: [image],
  });
});

test('browser image policy keeps attachments across remounts but does not persist them', async () => {
  const { registry, draft, storage, values } = setup(false);
  await draft.initialize();
  draft.update(() => ({ text: 'Browser draft', images: [image] }));
  await draft.flush();
  assert.equal(registry.get(id).getState().draft.images[0], image);
  assert.deepEqual(JSON.parse(values.get(key)), { text: 'Browser draft', images: [] });
  const reloaded = new SessionDrafts({ server: 'relay-one', storage, persistImages: false }).get(
    id,
  );
  await reloaded.initialize();
  assert.deepEqual(reloaded.getState().draft, { text: 'Browser draft', images: [] });
});
