import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSessionContext } from '@earendil-works/pi-coding-agent';
import { bridgeCommand } from '../dist/shared/commands.js';
import { fakePi, nativePi, setup, waitFor } from './bridge-fixture.mjs';

test('browser images reach native Pi as structured user content, including image-only messages', async (t) => {
  const { config, defer, file, header, entry, url, bridges } = await setup(t);
  const fake = nativePi({ defer, file, header, entry, url });
  await fake.emit('session_start');
  await waitFor(() => bridges.list()[0]?.connection === 'connected');
  const session = bridges.list()[0];
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=',
    'base64',
  );
  // Valid PNG with trailing padding exercises requests beyond the former 1 MiB body limit.
  const image = {
    type: 'image',
    mimeType: 'image/png',
    data: Buffer.concat([png, Buffer.alloc(800_000)]).toString('base64'),
  };
  for (const [index, type] of ['prompt', 'steer', 'follow_up'].entries()) {
    const message = index === 0 ? '' : 'Look at this screenshot';
    const images = index === 2 ? [image, image] : [image];
    const response = await fetch(
      `http://127.0.0.1:${config.port}/sessions/${session.id}/commands`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: `image-${index}`,
          generation: session.generation,
          command: { type, message, images },
        }),
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(fake.sent[index].message, [{ type: 'text', text: message }, ...images]);
    assert.equal(fake.sent[index].expandPromptTemplates, false);
    assert.equal(fake.appended.length, index + 1);
    assert.equal(fake.appended[index].customType, 'pim-image-attachments');
    assert.deepEqual(fake.appended[index].data, { count: images.length, mode: type });
  }
  assert.equal(fake.sent[1].deliverAs, 'steer');
  assert.equal(fake.sent[2].deliverAs, 'followUp');
  assert.deepEqual(buildSessionContext(fake.state.entries).messages, [entry.message]);

  // A fresh extension can render persisted metadata without the original image files or bytes.
  const reloaded = fakePi(header, file, entry);
  const render = reloaded.renderers.get('pim-image-attachments');
  const theme = { fg: (_color, text) => text };
  for (const [index, saved] of JSON.parse(JSON.stringify(fake.appended)).entries()) {
    const component = render(saved, { expanded: false }, theme);
    const label = [
      'Pim: 1 image submitted (prompt)',
      'Pim: 1 image submitted (steer)',
      'Pim: 2 images submitted (follow-up)',
    ][index];
    assert.deepEqual(component.render(80), [label]);
    assert.deepEqual(component.render(8), [label.slice(0, 8)]);
    component.invalidate();
    assert.deepEqual(component.render(80), [label]);
  }
  for (const data of [null, {}, { count: -1, mode: 'prompt' }, { count: 1, mode: 'bad' }]) {
    assert.equal(render({ data }, {}, theme), undefined);
  }
  fake.state.idle = false;
  await assert.rejects(
    bridges.command(session.id, session.generation, {
      type: 'prompt',
      message: 'Busy image',
      images: [image],
    }),
    /busy/,
  );
  await bridges.command(session.id, session.generation, { type: 'abort' });
  assert.equal(fake.appended.length, 3);
});

test('image policy rejects unsupported types, malformed data, excess count and size', () => {
  const image = {
    type: 'image',
    mimeType: 'image/png',
    data: Buffer.from('\u0089PNG\r\n\u001a\n', 'latin1').toString('base64'),
  };
  assert.equal(bridgeCommand({ type: 'prompt', message: '', images: [image] }).images.length, 1);
  for (const images of [
    [{ ...image, mimeType: 'image/svg+xml' }],
    [{ ...image, data: '!invalid' }],
    [{ ...image, data: 'aGVsbG8=' }],
    Array(5).fill(image),
    [{ ...image, data: Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64') }],
    'not-an-array',
  ]) {
    assert.throws(() => bridgeCommand({ type: 'prompt', message: 'Image', images }));
  }
  assert.throws(() => bridgeCommand({ type: 'prompt', message: '', images: [] }));
  assert.throws(() => bridgeCommand({ type: 'prompt', message: '/new', images: [image] }));
});
