import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.ts';
import { SessionCommands } from '../src/session/commands.ts';
import { settleComposerDraft } from '../src/session/draft.ts';

const id = '11111111-1111-1111-1111-111111111111';
const image = { type: 'image', mimeType: 'image/png', data: 'original' };

for (const outcome of ['rejected', 'unknown']) {
  test(`${outcome} commands preserve composer text and image references without replay`, async () => {
    const draft = { text: 'Review this screenshot', images: [image] };
    const values = new Map();
    let calls = 0;
    const commands = new SessionCommands(id, 'project', {
      connection: () => ({
        status: 'ready',
        snapshot: { session: { id, projectId: 'project', connection: 'connected', generation: 3 } },
      }),
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
      },
      dispatch: async (_id, _generation, command) => {
        calls++;
        assert.equal(command.message, draft.text);
        assert.equal(command.images, draft.images);
        throw new ApiError('Submission failed', outcome);
      },
      refresh: () => {},
    });
    const command = { type: 'prompt', message: draft.text, images: draft.images };
    const accepted = await commands.submit(command);
    assert.equal(accepted, false);
    assert.equal(settleComposerDraft(draft, draft, accepted), draft);
    assert.equal(calls, 1);
    assert.equal(commands.getState().uncertain, outcome === 'unknown');
    if (outcome === 'unknown') {
      assert.equal(await commands.submit(command), false);
      assert.equal(calls, 1);
    }
  });
}

test('acceptance clears the submitted text and images', () => {
  const submitted = { text: 'Review', images: [image] };
  assert.deepEqual(settleComposerDraft(submitted, submitted, true), { text: '', images: [] });
});

test('acceptance preserves newer text while clearing the accepted images', () => {
  const submitted = { text: 'Review', images: [image] };
  const current = { ...submitted, text: 'Next question' };
  assert.deepEqual(settleComposerDraft(current, submitted, true), {
    text: 'Next question',
    images: [],
  });
});

test('acceptance preserves newer images while clearing the accepted text', () => {
  const submitted = { text: 'Review', images: [image] };
  const current = { ...submitted, images: [{ ...image, data: 'new' }] };
  const next = settleComposerDraft(current, submitted, true);
  assert.equal(next.text, '');
  assert.equal(next.images, current.images);
});

test('non-acceptance preserves edits and attachment removals made during submission', () => {
  const submitted = { text: 'Review', images: [image] };
  const current = { text: 'Changed', images: [] };
  assert.equal(settleComposerDraft(current, submitted, false), current);
});

test('image-only submission keeps its image after failure and clears it only after acceptance', () => {
  const submitted = { text: '   ', images: [image] };
  assert.equal(settleComposerDraft(submitted, submitted, false), submitted);
  assert.deepEqual(settleComposerDraft(submitted, submitted, true), { text: '', images: [] });
});
