import assert from 'node:assert/strict';
import test from 'node:test';
import { imageAttachments } from '../../src/shared/attachments.ts';
import { emptyView } from '../../src/shared/client-state.ts';
import { sessionActivity } from '../../src/shared/session-activity.ts';
import { sessionControls } from '../../src/shared/session-controls.ts';
import { readState } from '../../src/shared/session-read-state.ts';
import { session } from '../../src/shared/sessions.ts';
import { snapshot as parseSnapshot } from '../../src/shared/snapshots.ts';
import { boundary } from './live-fixture.mjs';

test('session validation requires native identity and valid connection metadata', () => {
  const native = boundary().session;
  assert.equal(session(native).connection, 'connected');
  assert.throws(() => session({ ...native, piSessionId: undefined }));
  assert.throws(() => session({ ...native, connection: 'invalid' }));
  assert.throws(() => session({ ...native, generation: -1 }));
  const tmuxSession = 'lpi-12345678-1234-1234-1234-123456789abc';
  assert.equal(session({ ...native, tmuxSession }).tmuxSession, tmuxSession);
  assert.throws(() => session({ ...native, tmuxSession: 'lpi-$(touch injected)' }));
});

test('activity describes current work independently of completion notifications', () => {
  const view = emptyView();
  assert.equal(sessionActivity(true, {}, view), 'idle');
  assert.equal(sessionActivity(true, {}, { ...view, running: true }), 'running');
  assert.equal(sessionActivity(true, {}, { ...view, compacting: true }), 'running');
  assert.equal(sessionActivity(true, { isStreaming: true }, view), 'running');
  assert.equal(sessionActivity(true, { hasPendingMessages: true }, view), 'idle');
  assert.equal(
    sessionActivity(true, { pendingDialog: 'Confirm?' }, { ...view, running: true }),
    'blocked',
  );
  assert.equal(sessionActivity(false, { pendingDialog: 'Confirm?' }, view), 'unknown');
});

test('shared image validation accepts raster attachments and rejects invalid clipboard data', () => {
  const image = {
    type: 'image',
    mimeType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=',
  };
  assert.deepEqual(imageAttachments([image]), [image]);
  assert.throws(() => imageAttachments([{ ...image, mimeType: 'image/svg+xml' }]));
  assert.throws(() => imageAttachments([{ ...image, data: 'not-base64' }]));
});

test('context usage preserves unknown values and rejects malformed statistics', () => {
  const controls = boundary().controls;
  assert.equal(sessionControls(controls).contextUsage.percent, 30);
  controls.contextUsage.tokens = null;
  controls.contextUsage.percent = null;
  assert.deepEqual(sessionControls(controls).contextUsage, {
    tokens: null,
    contextWindow: 200000,
    percent: null,
  });
  assert.throws(() => sessionControls({ ...controls, contextUsage: { tokens: 1 } }));
  assert.throws(() => sessionControls({ ...controls, model: {} }));
  assert.deepEqual(sessionControls(controls).availableModels, controls.availableModels);
  assert.throws(() => sessionControls({ ...controls, availableModels: [{}] }));
  assert.throws(() => sessionControls({ ...controls, scopedModels: [{}] }));
  assert.deepEqual(
    sessionControls({ ...controls, scopedModels: controls.availableModels }).scopedModels,
    controls.availableModels,
  );
  assert.throws(() => sessionControls({ ...controls, thinkingLevel: 'invalid' }));
  assert.throws(() => sessionControls({ ...controls, availableThinkingLevels: ['invalid'] }));
  assert.deepEqual(
    sessionControls({ ...controls, thinkingLevel: 'max', availableThinkingLevels: ['high', 'max'] })
      .availableThinkingLevels,
    ['high', 'max'],
  );
});

test('read-state validation rejects missing or malformed metadata', () => {
  for (const invalid of [
    {},
    { completionId: 12, viewedCompletionId: null },
    { completionId: null, viewedCompletionId: 'bad' },
  ]) {
    assert.throws(() => readState(invalid), /Invalid session read state/);
    assert.throws(() => parseSnapshot({ ...boundary(), readState: invalid }));
  }
});
