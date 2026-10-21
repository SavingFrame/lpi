import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Disclosure } from '../src/components/disclosure.ts';
import { sameTranscriptTool } from '../src/transcript-state.ts';

test('collapsed disclosures do not construct or render hidden bodies', () => {
  let calls = 0;
  const html = renderToStaticMarkup(
    createElement(Disclosure, { className: 'tool-block', summary: 'Output' }, () => {
      calls++;
      return createElement('pre', null, 'Expensive output');
    }),
  );
  assert.equal(calls, 0);
  assert.equal(html, '<details class="tool-block"><summary>Output</summary></details>');
});

test('default-open disclosures mount their bodies immediately', () => {
  let calls = 0;
  const html = renderToStaticMarkup(
    createElement(Disclosure, { summary: 'Edit', defaultOpen: true }, () => {
      calls++;
      return createElement('pre', null, 'Applied changes');
    }),
  );
  assert.equal(calls, 1);
  assert.match(html, /<details open="">/);
  assert.match(html, /Applied changes/);
});

test('completed tool projections compare equal while all display changes invalidate', () => {
  const tool = {
    name: 'read',
    args: { path: 'file.ts' },
    result: { role: 'toolResult', timestamp: 1, content: 'Saved output' },
    progress: undefined,
    status: 'Completed',
  };
  assert.equal(sameTranscriptTool(tool, { ...tool }), true);
  for (const change of [
    { name: 'bash' },
    { args: { path: 'another.ts' } },
    { result: { ...tool.result, content: 'New output' } },
    { progress: { content: 'Progress' } },
    { status: 'Failed' },
  ]) {
    assert.equal(sameTranscriptTool(tool, { ...tool, ...change }), false);
  }
});
