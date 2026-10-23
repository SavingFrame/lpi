import assert from 'node:assert/strict';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { registerShow } from '../dist/extensions/lpi/native/show.js';
import { displayArtifact, MAX_HTML_BYTES } from '../dist/src/shared/display.js';
import { fakePi } from './bridge-fixture.mjs';
import { fixture } from './helpers.mjs';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8uoAAAAASUVORK5CYII=',
  'base64',
);
const saved = (result) =>
  JSON.parse(
    JSON.stringify({
      role: 'toolResult',
      toolName: 'show',
      timestamp: 1,
      ...result,
    }),
  );

test('bridge registers direct show, snapshots HTML/images and retains short model output after source deletion', async (t) => {
  const { root, config } = fixture(t);
  const cwd = config.projects[0].directory;
  const fake = fakePi({ cwd, id: 'display-test' }, join(root, 'unused.jsonl'), {
    type: 'message',
    id: 'first',
    message: { role: 'user', timestamp: 1, content: 'Show a chart' },
  });
  const tool = fake.tools.get('show');
  assert.equal(tool.exposure, 'model-only', 'nested calls cannot silently lose display history');
  // Pi contributes active tools' public promptGuidelines to its system-prompt rules.
  const guidance = tool.promptGuidelines.join('\n');
  assert.match(guidance, /use show proactively/i);
  assert.match(guidance, /line chart.*CPU usage over 10 seconds/);
  assert.match(guidance, /text-only/);
  assert.match(guidance, /actual data/);
  assert.match(guidance, /CDNs/);
  const html = '<!doctype html><button onclick="this.textContent=42">Chart</button>';
  await writeFile(join(cwd, 'chart.html'), html);
  await writeFile(join(cwd, 'pixel.png'), png);
  const invoke = (path) =>
    tool.execute(
      'show-1',
      { path, title: 'Example', summary: 'A useful visual.' },
      new AbortController().signal,
      undefined,
      fake.ctx,
    );
  const htmlResult = saved(await invoke('chart.html'));
  const imageResult = saved(await invoke(join(cwd, 'pixel.png')));
  await unlink(join(cwd, 'chart.html'));
  await unlink(join(cwd, 'pixel.png'));
  assert.equal(displayArtifact(htmlResult).html, html);
  assert.equal(displayArtifact(imageResult).image.data, png.toString('base64'));
  assert.match(htmlResult.content[0].text, /Saved inline visual for lpi: Example/);
  assert.match(htmlResult.content[0].text, /A useful visual/);
  assert.equal(JSON.stringify(htmlResult.content).includes(html), false);
  for (const invalid of [
    { ...htmlResult, isError: true },
    { ...htmlResult, toolName: 'read' },
    { ...htmlResult, role: 'assistant' },
    { ...htmlResult, details: { lpiDisplay: { ...htmlResult.details.lpiDisplay, version: 2 } } },
    { ...htmlResult, details: { lpiDisplay: { ...htmlResult.details.lpiDisplay, html: 123 } } },
    {
      ...htmlResult,
      details: { lpiDisplay: { ...htmlResult.details.lpiDisplay, filename: '../secret.html' } },
    },
    {
      ...imageResult,
      details: {
        lpiDisplay: {
          ...imageResult.details.lpiDisplay,
          image: { type: 'image', mimeType: 'image/png', data: 'AAAA' },
        },
      },
    },
  ]) {
    assert.equal(
      displayArtifact(invalid),
      undefined,
      'invalid or unrelated data keeps the raw fallback',
    );
  }
  await fake.emit('session_shutdown');
});

test('show accepts HTML directly without a file and rejects ambiguous inputs or viewport-driven layouts', async () => {
  let tool;
  registerShow({
    registerTool: (value) => {
      tool = value;
    },
  });
  const invoke = (params) =>
    tool.execute(
      'inline',
      { summary: 'A useful visual.', ...params },
      new AbortController().signal,
      undefined,
      { cwd: '/not-a-real-directory' },
    );
  const html =
    '<script src="https://cdn.example/chart.js"></script><link rel="stylesheet" href="https://cdn.example/chart.css"><h3>Turn volume</h3><svg viewBox="0 0 100 30"><rect width="80" height="20" fill="var(--chart-1)"/></svg>';
  const result = saved(await invoke({ html, title: 'Turn volume' }));
  assert.equal(displayArtifact(result).html, html);
  assert.equal(displayArtifact(result).filename, 'Turn-volume.html');
  assert.equal(JSON.stringify(result.content).includes('<svg'), false);
  for (const params of [{}, { path: 'missing.html', html }]) {
    await assert.rejects(invoke(params), /exactly one/);
  }
  await assert.rejects(invoke({ html: 'é'.repeat(MAX_HTML_BYTES) }), /at most 1 MiB/);
  await assert.rejects(invoke({ html: ' ' }), /nonempty/);
  await assert.rejects(invoke({ html: '<style>main{height:100dvh}</style>' }), /viewport-height/);
});

test('show rejects unsupported, oversized, non-regular, invalid UTF-8 and corrupt image files, and observes abort', async (t) => {
  const { root } = fixture(t);
  let tool;
  registerShow({
    registerTool: (value) => {
      tool = value;
    },
  });
  const invoke = (path, signal = new AbortController().signal) =>
    tool.execute('show-1', { path, summary: 'Summary' }, signal, undefined, { cwd: root });
  await mkdir(join(root, 'directory.html'));
  await writeFile(join(root, 'large.html'), 'x'.repeat(MAX_HTML_BYTES + 1));
  await writeFile(join(root, 'broken.html'), Buffer.from([0xff]));
  await writeFile(join(root, 'broken.png'), 'not a PNG');
  await writeFile(join(root, 'empty.html'), '');
  for (const [path, expected] of [
    ['secret.txt', /supports HTML/],
    ['missing.html', /ENOENT/],
    ['large.html', /regular file/],
    ['directory.html', /regular file/],
    ['broken.html', /encoded data/],
    ['broken.png', /contents do not match/],
    ['empty.html', /empty/],
    ['.', /supports HTML/],
  ]) {
    await assert.rejects(invoke(path), expected);
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(invoke('broken.html', controller.signal), { name: 'AbortError' });
});
