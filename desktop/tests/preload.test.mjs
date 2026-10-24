import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

test('preload exposes narrow desktop methods, strips IPC events and removes subscriptions', async () => {
  let bridge;
  let callback;
  const calls = [];
  const frame = {};
  runInNewContext(
    readFileSync(new URL('../../dist/desktop/preload/index.cjs', import.meta.url), 'utf8'),
    {
      window: { top: frame },
      require: (name) => {
        assert.equal(name, 'electron');
        return {
          contextBridge: {
            exposeInMainWorld: (_name, value) => {
              bridge = value;
            },
          },
          ipcRenderer: {
            invoke: async (...args) => {
              calls.push(args);
              return 1.25;
            },
            on: (_channel, listener) => {
              callback = listener;
            },
            removeListener: (channel, listener) => {
              assert.equal(channel, 'lpi:zoom:changed');
              assert.equal(listener, callback);
              callback = undefined;
            },
          },
        };
      },
    },
  );
  assert.equal(bridge, undefined, 'subframes receive no API');

  const window = {};
  window.top = window;
  runInNewContext(
    readFileSync(new URL('../../dist/desktop/preload/index.cjs', import.meta.url), 'utf8'),
    {
      window,
      require: () => ({
        contextBridge: {
          exposeInMainWorld: (name, value) => {
            assert.equal(name, 'lpiDesktop');
            bridge = value;
          },
        },
        ipcRenderer: {
          invoke: async (...args) => {
            calls.push(args);
            return 1.25;
          },
          on: (_channel, listener) => {
            callback = listener;
          },
          removeListener: (_channel, listener) => {
            assert.equal(listener, callback);
            callback = undefined;
          },
        },
      }),
    },
  );
  assert.deepEqual(Object.keys(bridge).sort(), [
    'copyText',
    'getZoom',
    'notify',
    'onCloseTab',
    'onNotificationClicked',
    'onZoomChanged',
    'setZoom',
  ]);
  const closed = [];
  const stopClosing = bridge.onCloseTab((...args) => closed.push(args));
  callback({ secret: 'must not reach renderer' });
  assert.deepEqual(closed, [[]]);
  stopClosing();
  assert.equal(callback, undefined);
  assert.equal(await bridge.getZoom(), 1.25);
  await bridge.setZoom(1.5);
  assert.deepEqual(calls, [['lpi:zoom:get'], ['lpi:zoom:set', 1.5]]);
  await bridge.copyText('tmux -L lpi attach-session -t =lpi-example');
  assert.deepEqual(calls.at(-1), [
    'lpi:clipboard:write',
    'tmux -L lpi attach-session -t =lpi-example',
  ]);
  const values = [];
  const unsubscribe = bridge.onZoomChanged((...args) => values.push(args));
  callback({ secret: 'must not reach renderer' }, 1.5);
  assert.deepEqual(values, [[1.5]]);
  unsubscribe();
  assert.equal(callback, undefined);
  const notification = {
    sessionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    projectId: 'b'.repeat(64),
    title: 'Session',
    body: '',
    kind: 'input',
  };
  await bridge.notify(notification);
  assert.equal(calls.at(-1)[0], 'lpi:notify');
  const clicked = [];
  const stop = bridge.onNotificationClicked((...args) => clicked.push(args));
  callback({ secret: true }, notification);
  callback({}, { ...notification, projectId: 'https://evil.test' });
  callback({}, { ...notification, body: 'x'.repeat(201) });
  callback({}, { ...notification, body: 42 });
  assert.deepEqual(clicked, [[notification]]);
  stop();
  assert.equal(callback, undefined);
});
