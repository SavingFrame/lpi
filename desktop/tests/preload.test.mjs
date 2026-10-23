import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

test('preload exposes only scale methods, strips IPC events and removes subscriptions', async () => {
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
              assert.equal(channel, 'pim:zoom:changed');
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
            assert.equal(name, 'pimDesktop');
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
  assert.deepEqual(Object.keys(bridge).sort(), ['getZoom', 'onZoomChanged', 'setZoom']);
  assert.equal(await bridge.getZoom(), 1.25);
  await bridge.setZoom(1.5);
  assert.deepEqual(calls, [['pim:zoom:get'], ['pim:zoom:set', 1.5]]);
  const values = [];
  const unsubscribe = bridge.onZoomChanged((...args) => values.push(args));
  callback({ secret: 'must not reach renderer' }, 1.5);
  assert.deepEqual(values, [[1.5]]);
  unsubscribe();
  assert.equal(callback, undefined);
});
