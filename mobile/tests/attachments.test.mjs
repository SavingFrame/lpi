import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_IMAGE_BYTES } from '../../src/shared/attachments.ts';
import { messageBlocks } from '../src/features/conversation/content.ts';
import { pickedImages } from '../src/lib/attachments.ts';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

test('picker bytes determine MIME, selected images append, and history renders embedded images', () => {
  const existing = pickedImages([{ base64: png }], []);
  const images = pickedImages([{ base64: '/9j/AAAA' }], existing);
  assert.equal(images.length, 2);
  assert.equal(images[0].mimeType, 'image/png');
  assert.equal(images[1].mimeType, 'image/jpeg');
  assert.deepEqual(messageBlocks({ role: 'user', content: [images[0]], timestamp: 1 }), [
    {
      kind: 'image',
      label: 'Image attachment',
      text: '',
      uri: `data:image/png;base64,${png}`,
    },
  ]);
});

test('attachment validation works without browser base64 globals on native runtimes', () => {
  const original = globalThis.atob;
  try {
    globalThis.atob = undefined;
    assert.equal(pickedImages([{ base64: png }], [])[0].mimeType, 'image/png');
  } finally {
    globalThis.atob = original;
  }
});

test('picker rejects missing, invalid, unsupported, over-count and aggregate oversized data atomically', () => {
  const existing = pickedImages([{ base64: png }], []);
  for (const assets of [[{}], [{ base64: '!!!' }], [{ base64: btoa('unsupported format') }]]) {
    assert.throws(() => pickedImages(assets, existing));
    assert.equal(existing.length, 1);
  }
  assert.throws(
    () =>
      pickedImages(
        Array.from({ length: 4 }, () => ({ base64: png })),
        existing,
      ),
    /at most 4 images/,
  );
  const large = btoa(`\x89PNG\r\n\x1a\n${'x'.repeat(MAX_IMAGE_BYTES / 2)}`);
  assert.throws(() => pickedImages([{ base64: large }, { base64: large }], []), /4 MiB/);
});
