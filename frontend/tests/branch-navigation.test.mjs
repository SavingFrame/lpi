import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyView } from '../../src/shared/client-state.ts';
import { ApiError } from '../src/api.ts';
import {
  BranchSelections,
  branchAction,
  branchSelections,
  navigateBranch,
  requestBranchSelection,
} from '../src/session/branch-navigation.ts';
import { SessionCommands } from '../src/session/commands.ts';

const id = '11111111-1111-1111-1111-111111111111';
const intent = { sessionId: id, entryId: 'target', action: 'switch' };
function setup() {
  let connection = {
    status: 'ready',
    error: null,
    snapshot: {
      session: { id, projectId: 'project', connection: 'connected', generation: 3 },
      view: emptyView(),
      state: { leafId: 'current' },
    },
  };
  let available = true;
  let current = true;
  const requests = [];
  const previews = [];
  const environment = {
    connection: () => connection,
    available: () => available,
    current: () => current,
    preview: async (sessionId, entryId) => {
      previews.push({ sessionId, entryId });
      return {
        sessionId,
        entryId,
        messages: [{ role: 'user', entryId, content: 'Selected prompt', timestamp: 1 }],
      };
    },
    submit: async (command) => {
      requests.push(command);
      return true;
    },
  };
  return {
    environment,
    requests,
    previews,
    state: () => connection,
    setConnection: (next) => {
      connection = next;
    },
    setAvailable: (next) => {
      available = next;
    },
    setCurrent: (next) => {
      current = next;
    },
  };
}

test('an idle click switches directly once and returns the selected user draft', async () => {
  const { environment, requests } = setup();
  const result = await navigateBranch(intent, 'project', environment);
  assert.deepEqual(requests, [
    { type: 'navigate_tree', targetId: 'target', expectedLeafId: 'current' },
  ]);
  assert.deepEqual(result, { type: 'switched', draft: { text: 'Selected prompt', images: [] } });
});

test('selecting the current leaf returns to live without preview loading or a command, even when busy', async () => {
  const { environment, state, previews, requests } = setup();
  state().snapshot.state.leafId = 'target';
  state().snapshot.view.running = true;
  assert.deepEqual(await navigateBranch(intent, 'project', environment), { type: 'current' });
  assert.equal(previews.length, 0);
  assert.equal(requests.length, 0);
});

for (const status of ['connecting', 'syncing', 'offline']) {
  test(`${status} clicks remain previews`, async () => {
    const { environment, state, requests, previews } = setup();
    state().status = status;
    assert.deepEqual(await navigateBranch(intent, 'project', environment), { type: 'preview' });
    assert.equal(requests.length, 0);
    assert.equal(previews.length, 0);
  });
}

for (const change of [
  (state) => {
    state.snapshot.session.connection = 'disconnected';
  },
  (state) => {
    state.snapshot.session.id = 'another-session';
  },
  (state) => {
    state.snapshot.session.projectId = 'another-project';
  },
  (state) => {
    state.snapshot.view.running = true;
  },
  (state) => {
    state.snapshot.view.compacting = true;
  },
  (state) => {
    state.snapshot.view.notice = 'Native dialog requires terminal input';
  },
  (state) => {
    state.snapshot.state.isStreaming = true;
  },
  (state) => {
    state.snapshot.state.hasPendingMessages = true;
  },
  (state) => {
    state.snapshot.state.pendingDialog = {};
  },
  (state) => {
    delete state.snapshot.state.leafId;
  },
  (state) => {
    state.snapshot = null;
  },
]) {
  test('unavailable, busy and unrelated snapshots never switch', async () => {
    const { environment, state, requests } = setup();
    change(state());
    assert.equal(branchAction(state(), id, 'project', 'target', true), 'preview');
    assert.deepEqual(await navigateBranch(intent, 'project', environment), { type: 'preview' });
    assert.equal(requests.length, 0);
  });
}

test('pending/uncertain command availability blocks direct switching', async () => {
  const { environment, setAvailable, requests } = setup();
  setAvailable(false);
  assert.deepEqual(await navigateBranch(intent, 'project', environment), { type: 'preview' });
  assert.equal(requests.length, 0);
});

for (const change of [
  (setup) => {
    setup.setConnection({
      ...setup.state(),
      snapshot: {
        ...setup.state().snapshot,
        session: { ...setup.state().snapshot.session, generation: 4 },
      },
    });
  },
  (setup) => {
    setup.state().snapshot.state = { leafId: 'another-leaf' };
  },
  (setup) => {
    setup.state().snapshot.view.running = true;
  },
  (setup) => {
    setup.state().status = 'offline';
  },
  (setup) => {
    setup.setAvailable(false);
  },
]) {
  test('changes during preview loading prevent stale dispatch', async () => {
    const setupState = setup();
    const { environment, requests } = setupState;
    const preview = environment.preview;
    environment.preview = async (...args) => {
      const result = await preview(...args);
      change(setupState);
      return result;
    };
    assert.deepEqual(await navigateBranch(intent, 'project', environment), { type: 'preview' });
    assert.equal(requests.length, 0);
  });
}

test('rapid selections cancel older preparation and stale acknowledgments do not restore drafts', async () => {
  const setupState = setup();
  const { environment, setCurrent, requests } = setupState;
  const deferred = Promise.withResolvers();
  environment.preview = () => deferred.promise;
  const pending = navigateBranch(intent, 'project', environment);
  setCurrent(false);
  deferred.resolve({ ...intent, messages: [] });
  assert.deepEqual(await pending, { type: 'cancelled' });
  assert.equal(requests.length, 0);
  setCurrent(true);
  environment.preview = async () => ({ ...intent, messages: [] });
  environment.submit = async (command) => {
    requests.push(command);
    setCurrent(false);
    return true;
  };
  assert.deepEqual(await navigateBranch(intent, 'project', environment), { type: 'preview' });
});

test('unsupported attachments remain a preview without moving Pi', async () => {
  const { environment, requests } = setup();
  environment.preview = async () => ({
    sessionId: id,
    entryId: 'target',
    messages: [
      {
        role: 'user',
        entryId: 'target',
        content: [{ type: 'image', mimeType: 'image/svg+xml', data: 'invalid' }],
        timestamp: 1,
      },
    ],
  });
  await assert.rejects(
    navigateBranch(intent, 'project', environment),
    /attachments.*cannot be restored/,
  );
  assert.equal(requests.length, 0);
});

test('click intents are session-specific, consumed once, and not replayed after reconnect or becoming idle', async () => {
  const selections = new BranchSelections();
  assert.equal(selections.take(id, 'target'), null, 'a preview URL alone grants no authority');
  selections.request(id, 'target', 'switch');
  assert.equal(selections.take('other', 'target'), null);
  assert.equal(selections.take(id, 'other'), null);
  const selected = selections.take(id, 'target');
  assert.ok(selected);
  assert.equal(selections.take(id, 'target'), null);
  const { environment, state, requests } = setup();
  state().snapshot.view.running = true;
  assert.deepEqual(await navigateBranch(selected, 'project', environment), { type: 'preview' });
  state().snapshot.view.running = false;
  assert.equal(selections.take(id, 'target'), null);
  assert.equal(requests.length, 0);
  selections.request(id, 'new-target', 'switch');
  assert.equal(selections.isLatest(selected), false);
});

test('busy or unloaded clicks cannot turn into switches before the page consumes them', async () => {
  for (const initial of ['busy', 'unloaded']) {
    const fixture = setup();
    const { environment, requests } = fixture;
    const atClick = setup().state();
    if (initial === 'busy') {
      atClick.snapshot.view.running = true;
    } else {
      atClick.snapshot = null;
    }
    const action = branchAction(atClick, id, 'project', 'target', true);
    const selections = new BranchSelections();
    selections.request(id, 'target', action);
    const selected = selections.take(id, 'target');
    assert.deepEqual(await navigateBranch(selected, 'project', environment), { type: 'preview' });
    assert.equal(requests.length, 0);
  }
});

test('an active-entry click never becomes a rewind if Pi moves before the click is consumed', async () => {
  const { environment, requests } = setup();
  assert.deepEqual(await navigateBranch({ ...intent, action: 'current' }, 'project', environment), {
    type: 'current',
  });
  assert.equal(requests.length, 0);
});

test('leaving a preview discards pending intent without cancelling a newer selection', () => {
  const selections = new BranchSelections();
  selections.request(id, 'target', 'switch');
  selections.discard(id, 'target');
  assert.equal(selections.take(id, 'target'), null);
  selections.request(id, 'target', 'switch');
  const selected = selections.take(id, 'target');
  selections.request(id, 'new-target', 'switch');
  selections.discard(id, 'target');
  assert.equal(selections.isLatest(selected), false);
  assert.ok(selections.take(id, 'new-target'));
});

test('modified clicks keep ordinary browser navigation without authorizing mutations', () => {
  const existing = branchSelections.getState();
  if (existing) {
    branchSelections.take(existing.sessionId, existing.entryId);
  }
  for (const change of [
    { button: 1 },
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
    { defaultPrevented: true },
  ]) {
    requestBranchSelection({ button: 0, ...change }, id, 'project', 'target', setup().state());
    assert.equal(branchSelections.getState(), null);
  }
  requestBranchSelection({ button: 0 }, id, 'project', 'target', setup().state());
  assert.deepEqual(branchSelections.take(id, 'target'), intent);
});

for (const outcome of ['rejected', 'unknown']) {
  test(`${outcome} navigation is not replayed and retains command-lane safety`, async () => {
    const { environment, requests } = setup();
    const values = new Map();
    const commands = new SessionCommands(id, 'project', {
      connection: environment.connection,
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
      },
      dispatch: async (_id, _generation, command) => {
        requests.push(command);
        throw new ApiError('Navigation failed', outcome);
      },
      refresh: () => {},
    });
    environment.available = commands.available;
    environment.submit = commands.submit;
    assert.deepEqual(await navigateBranch(intent, 'project', environment), { type: 'preview' });
    assert.equal(requests.length, 1);
    assert.equal(commands.getState().uncertain, outcome === 'unknown');
    if (outcome === 'unknown') {
      assert.deepEqual(await navigateBranch(intent, 'project', environment), { type: 'preview' });
      assert.equal(requests.length, 1);
    }
  });
}
