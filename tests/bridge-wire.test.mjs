import assert from 'node:assert/strict';
import test from 'node:test';
import { BridgeReader, BridgeWriter } from '../dist/bridge/wire.js';
import { BRIDGE_LIMIT } from '../dist/shared/commands.js';

function socket() {
  const sent = [];
  let terminated = false;
  let close;
  return {
    sent,
    get terminated() {
      return terminated;
    },
    on(event, callback) {
      assert.equal(event, 'close');
      close = callback;
    },
    send(data, callback) {
      sent.push({ data, callback });
    },
    terminate() {
      terminated = true;
      close();
    },
  };
}

test('chunk writer waits for each send and preserves logical message ordering', () => {
  const peer = socket();
  const writer = new BridgeWriter(peer);
  const reader = new BridgeReader(() => assert.fail('Unexpected timeout'));
  const large = { type: 'sync', content: '😀'.repeat(BRIDGE_LIMIT) };
  let flushed = false;
  writer.send(large);
  writer.send({ type: 'ack' }, () => {
    flushed = true;
  });
  assert.equal(peer.sent.length, 1);
  const received = [];
  for (let index = 0; index < peer.sent.length; index++) {
    const frame = peer.sent[index];
    assert.ok(Buffer.byteLength(frame.data) <= BRIDGE_LIMIT);
    const value = reader.read(frame.data);
    if (value) {
      received.push(value);
    }
    frame.callback();
  }
  assert.deepEqual(received, [large, { type: 'ack' }]);
  assert.equal(flushed, true);
  reader.dispose();
});

test('slow-peer queue overload and send failures terminate without reporting a flush', () => {
  for (const failSend of [false, true]) {
    const peer = socket();
    const writer = new BridgeWriter(peer);
    writer.send({ type: 'ack' }, () => assert.fail('Failed send must not flush'));
    if (failSend) {
      peer.sent[0].callback(new Error('Disconnected'));
    } else {
      for (let index = 0; index < 9; index++) {
        writer.send({ type: 'event', content: 'x'.repeat(1024 * 1024) });
      }
    }
    assert.equal(peer.terminated, true);
  }
});

test('reader rejects malformed, nested and interleaved chunks', () => {
  for (const frame of [
    { type: 'chunk', data: '', final: false },
    { type: 'chunk', data: 'x'.repeat(256 * 1024 + 1), final: false },
    { type: 'chunk', data: '{}', final: 'yes' },
    { type: 'chunk', data: JSON.stringify({ type: 'chunk' }), final: true },
    { type: 'chunk', data: 'invalid JSON', final: true },
  ]) {
    const reader = new BridgeReader(() => assert.fail('Unexpected timeout'));
    assert.throws(() => reader.read(JSON.stringify(frame)));
    reader.dispose();
  }
  const reader = new BridgeReader(() => assert.fail('Unexpected timeout'));
  assert.equal(reader.read(JSON.stringify({ type: 'chunk', data: '{', final: false })), undefined);
  assert.throws(() => reader.read(JSON.stringify({ type: 'event' })), /Interleaved/);
  reader.dispose();
});

test('incomplete transfer times out and disposal cancels the timer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let timeouts = 0;
  const reader = new BridgeReader(() => timeouts++);
  reader.read(JSON.stringify({ type: 'chunk', data: '{', final: false }));
  t.mock.timers.tick(30_000);
  assert.equal(timeouts, 1);
  reader.read(JSON.stringify({ type: 'chunk', data: '{', final: false }));
  reader.dispose();
  t.mock.timers.tick(30_000);
  assert.equal(timeouts, 1);
});
