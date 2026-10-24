import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { ProjectDiffController } from '../../src/client/project-diff.ts';
import { diffFiles } from '../../src/shared/diff-files.ts';

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sockets = [];
  const requests = [];
  const controller = new ProjectDiffController({
    read: (signal) => new Promise((resolve, reject) => requests.push({ signal, resolve, reject })),
    openSocket: () => {
      const socket = {
        readyState: 1,
        onmessage: null,
        onclose: null,
        onerror: null,
        close() {
          this.readyState = 3;
          this.onclose?.();
        },
        send(type) {
          this.onmessage?.({ data: JSON.stringify({ type }) });
        },
      };
      sockets.push(socket);
      return socket;
    },
  });
  t.after(controller.stop);
  return { controller, sockets, requests };
}

const result = (patch) => ({ patch, truncated: false });

test('live diff coalesces invalidations, retains history and drops requests after suspension', async (t) => {
  const { controller, sockets, requests } = setup(t);
  controller.start();
  sockets[0].send('diff-ready');
  requests[0].resolve(result('first'));
  await setImmediate();
  requests[1].resolve(result('first'));
  await setImmediate();
  const first = controller.getState().data;
  for (let i = 0; i < 5; i++) {
    sockets[0].send('diff-changed');
  }
  t.mock.timers.tick(199);
  assert.equal(requests.length, 2);
  t.mock.timers.tick(1);
  assert.equal(requests.length, 3);
  sockets[0].send('diff-changed');
  t.mock.timers.tick(200);
  assert.equal(requests.length, 3, 'never overlap a read');
  requests[2].resolve(result('second'));
  await setImmediate();
  assert.equal(requests.length, 4, 'one trailing read after in-flight changes');
  assert.equal(controller.getState().data.patch, 'second');
  controller.stop();
  assert.equal(requests[3].signal.aborted, true);
  requests[3].resolve(result('late'));
  sockets[0].send('diff-changed');
  t.mock.timers.tick(10000);
  await setImmediate();
  assert.equal(controller.getState().status, 'paused');
  assert.equal(controller.getState().data.patch, 'second');
  assert.notEqual(controller.getState().data, first);
  assert.equal(sockets.length, 1, 'backgrounded clients do not reconnect');
});

test('reconnect and foreground refresh authoritative diffs without accepting old socket events', async (t) => {
  const { controller, sockets, requests } = setup(t);
  controller.start();
  requests[0].resolve(result('saved'));
  await setImmediate();
  sockets[0].send('diff-ready');
  requests[1].resolve(result('saved'));
  await setImmediate();
  const saved = controller.getState().data;
  sockets[0].close();
  assert.equal(controller.getState().status, 'reconnecting');
  assert.equal(controller.getState().data, saved);
  t.mock.timers.tick(500);
  sockets[0].send('diff-ready');
  assert.equal(requests.length, 2);
  sockets[1].send('diff-ready');
  requests[2].reject(new Error('Git unavailable'));
  await setImmediate();
  assert.equal(controller.getState().data, saved);
  assert.match(controller.getState().error.message, /Git unavailable/);
  controller.stop();
  controller.start();
  requests[3].resolve(result('updated while away'));
  await setImmediate();
  assert.equal(controller.getState().data.patch, 'updated while away');
  assert.equal(controller.getState().error, null);
});

test('native diff projection preserves hunk numbers, quoted paths and metadata files', () => {
  const files = diffFiles(
    [
      'diff --git "a/\\303\\251.txt" "b/\\303\\251.txt"',
      '--- "a/\\303\\251.txt"',
      '+++ "b/\\303\\251.txt"',
      '@@ -2,2 +2,2 @@',
      ' context',
      '-old',
      '+new',
      '\\ No newline at end of file',
      'diff --git a/image.bin b/image.bin',
      'Binary files a/image.bin and b/image.bin differ',
      'diff --git a/before.txt b/after.txt',
      'similarity index 100%',
      'rename from before.txt',
      'rename to after.txt',
    ].join('\n'),
  );
  assert.equal(files[0].path, 'é.txt');
  assert.equal(files[0].additions, 1);
  assert.equal(files[0].deletions, 1);
  assert.deepEqual(files[0].lines[2], { kind: 'deletion', text: 'old', oldLine: 3 });
  assert.deepEqual(files[0].lines[3], { kind: 'addition', text: 'new', newLine: 3 });
  assert.equal(files[0].lines[4].kind, 'note');
  assert.equal(files[1].path, 'image.bin');
  assert.match(files[1].lines[0].text, /Binary files/);
  assert.equal(files[2].path, 'after.txt');
  assert.equal(files[2].previousPath, 'before.txt');
});
