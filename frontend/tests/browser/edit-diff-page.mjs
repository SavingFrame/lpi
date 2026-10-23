import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { emptyView } from '../../../src/shared/client-state.ts';
import { Transcript } from '../../src/transcript';
import '../../src/styles/transcript.css';

const check = (value, message) => {
  if (!value) {
    throw new Error(message);
  }
};
const waitFor = async (predicate) => {
  for (let i = 0; i < 500; i++) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Timed out waiting for diff rendering: ${document.querySelector('diffs-container')?.shadowRoot?.innerHTML.slice(-5000) ?? document.body.innerHTML}`,
  );
};
const violations = [];
document.addEventListener('securitypolicyviolation', (event) => {
  violations.push(event.effectiveDirective);
});
try {
  const host = document.createElement('main');
  document.body.append(host);
  const root = createRoot(host);
  const oldLine = 'const value = 1;';
  const newLine = `const value = "<img src=x onerror=alert(1)>${'long'.repeat(100)}";`;
  const patch = `--- src/example.ts\n+++ src/example.ts\n@@ -1 +1 @@\n-${oldLine}\n+${newLine}\n`;
  const toolResult = {
    role: 'toolResult',
    toolName: 'edit',
    toolCallId: 'edit-1',
    timestamp: 2,
    details: { patch },
    content: [{ type: 'text', text: 'Successfully replaced 1 block.' }],
  };
  const message = {
    role: 'assistant',
    timestamp: 1,
    content: [
      {
        type: 'toolCall',
        id: 'edit-1',
        name: 'edit',
        arguments: { path: 'src/example.ts', edits: [{ oldText: oldLine, newText: newLine }] },
      },
    ],
  };
  const render = (messages, overrides = {}) =>
    flushSync(() =>
      root.render(createElement(Transcript, { view: { ...emptyView(), messages, ...overrides } })),
    );
  const click = (node) => flushSync(() => node.click());
  const ordinary = (id, name) => ({ type: 'toolCall', id, name, arguments: { path: id } });
  const mixed = {
    ...message,
    content: [
      ordinary('read-before', 'read'),
      ordinary('bash-before', 'bash'),
      ...message.content,
      ordinary('read-after', 'read'),
      ordinary('bash-after', 'bash'),
    ],
  };
  render([mixed, toolResult]);
  await waitFor(() => host.querySelector('.edit-diff'));
  const editBlock = host.querySelector('.edit-diff').closest('.tool-block');
  check(editBlock.open, 'successful edits start open');
  check(!editBlock.closest('.tool-group'), 'edits are outside generic tool groups');
  check(
    host.querySelectorAll('.tool-group').length === 2,
    'ordinary calls stay grouped on either side',
  );
  check(
    [...host.querySelectorAll('.tool-group-calls > details')].every((node) => !node.open),
    'ordinary calls still start collapsed',
  );
  const viewer = () => host.querySelector('diffs-container')?.shadowRoot;
  await waitFor(() => viewer()?.querySelector('[data-unified]'));
  await waitFor(() => viewer()?.querySelector('[data-line] span[style]'));
  check(
    getComputedStyle(viewer().querySelector('[data-code]')).display === 'grid',
    'viewer stylesheet applies under production CSP',
  );
  const removed = viewer().querySelector('[data-line-type="change-deletion"][data-line]');
  check(removed.getBoundingClientRect().height > 0, 'removed row is visible');
  check(viewer().textContent.includes(oldLine), 'removed text renders');
  check(viewer().textContent.includes(newLine), 'added text renders');
  check(!viewer().querySelector('img'), 'patch HTML is not executable markup');
  check(!host.querySelector('.edit-raw pre'), 'raw output starts unmounted');
  const select = host.querySelector('select');
  flushSync(() => {
    select.value = 'split';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await waitFor(() => viewer()?.querySelector('[data-deletions]'));
  const bounds = host.querySelector('.edit-diff').getBoundingClientRect();
  check(bounds.width <= host.getBoundingClientRect().width, 'diff fits narrow container');
  check(
    document.documentElement.scrollWidth <= window.innerWidth,
    'long lines do not overflow page',
  );
  click(host.querySelector('.edit-raw > summary'));
  await waitFor(() => host.textContent.includes('Successfully replaced 1 block.'));
  click(editBlock.querySelector('summary'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  render([mixed, { ...toolResult }]);
  check(!editBlock.open, 'manual collapse survives transcript updates');
  render([{ ...toolResult, toolCallId: 'unpaired' }]);
  check(host.querySelector('.tool-block').open, 'unpaired saved edit starts open');
  await waitFor(() => viewer()?.querySelector('[data-diff]'));
  check(host.textContent.includes('Applied changes'), 'unpaired saved result renders a diff');
  render([message, { ...toolResult, details: { patch: 'invalid' } }]);
  await waitFor(() => host.textContent.includes('Successfully replaced 1 block.'));
  check(!host.querySelector('diffs-container'), 'invalid patch falls back');
  check(
    host.textContent.includes('Successfully replaced 1 block.'),
    'invalid patch preserves output',
  );
  render([
    message,
    { ...toolResult, isError: true, content: [{ type: 'text', text: 'No unique match' }] },
  ]);
  check(host.querySelector('.tool-block').open, 'failed edit starts open');
  await waitFor(() => host.textContent.includes('No unique match'));
  check(host.textContent.includes('No unique match'), 'failed edit exposes its error');
  check(!host.querySelector('diffs-container'), 'failed edit has no applied diff');
  render([]);
  render([message], {
    running: true,
    tools: [{ id: 'edit-1', name: 'edit', args: message.content[0].arguments }],
  });
  check(host.querySelector('.tool-block').open, 'live edit starts open');
  render([message, toolResult]);
  await waitFor(() => viewer()?.querySelector('[data-diff]'));
  check(host.querySelector('.tool-block').open, 'live completion keeps the edit open');
  const nestedMessages = [
    {
      ...message,
      content: [
        { type: 'toolCall', id: 'script', name: 'codemode', arguments: { code: '/* saved */' } },
      ],
    },
    {
      ...toolResult,
      toolName: 'codemode',
      toolCallId: 'script',
      isError: true,
      details: {
        calls: [
          {
            id: 'script/1',
            name: 'edit',
            args: '{"path":"src/example.ts","edits":...',
            status: 'ok',
          },
          { id: 'script/2', name: 'read', args: '{"path":"src/example.ts"}', status: 'ok' },
        ],
        pimEditPatches: [{ toolCallId: 'script/1', patch }],
      },
      content: [{ type: 'text', text: 'Script failed after applying edit' }],
    },
  ];
  render(nestedMessages);
  const nestedEdit = host.querySelector('.codemode-call');
  check(nestedEdit.open, 'nested edits start open');
  check(!host.querySelectorAll('.codemode-call')[1].open, 'other nested calls stay collapsed');
  await waitFor(() => viewer()?.querySelector('[data-unified]'));
  check(viewer().textContent.includes(newLine), 'nested successful edit survives script failure');
  check(!viewer().querySelector('img'), 'nested patch HTML is not executable markup');
  const nestedSelect = host.querySelector('select');
  flushSync(() => {
    nestedSelect.value = 'split';
    nestedSelect.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await waitFor(() => viewer()?.querySelector('[data-deletions]'));
  check(
    host.querySelector('.edit-diff').getBoundingClientRect().width <=
      host.getBoundingClientRect().width,
    'nested diff fits narrow container',
  );
  click(host.querySelector('.edit-raw > summary'));
  await waitFor(() => host.textContent.includes('Saved argument preview'));
  click(nestedEdit.querySelector('summary'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  render([...nestedMessages]);
  check(!nestedEdit.open, 'manual nested edit collapse survives transcript updates');
  root.unmount();
  const deferredHost = document.createElement('main');
  deferredHost.style.cssText = 'height:300px;overflow:auto';
  document.body.replaceChildren(deferredHost);
  const deferredRoot = createRoot(deferredHost);
  flushSync(() =>
    deferredRoot.render(
      createElement(
        'div',
        null,
        createElement('div', { style: { height: 3000 } }),
        createElement(Transcript, { view: { ...emptyView(), messages: [message, toolResult] } }),
      ),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  check(!deferredHost.querySelector('diffs-container'), 'offscreen diffs are not mounted');
  deferredHost.scrollTop = deferredHost.scrollHeight;
  await waitFor(() => deferredHost.querySelector('diffs-container'));
  const deferredViewer = deferredHost.querySelector('diffs-container');
  deferredHost.scrollTop = 0;
  await new Promise((resolve) => setTimeout(resolve, 100));
  check(
    deferredHost.querySelector('diffs-container') === deferredViewer,
    'visited diffs retain their state offscreen',
  );
  deferredRoot.unmount();
  check(
    violations.length === 0,
    `viewer must not violate production CSP: ${violations.join(', ')}`,
  );
  const script = document.createElement('script');
  script.textContent = 'document.body.dataset.inlineScriptRan = "yes";';
  document.body.append(script);
  await waitFor(() => violations.includes('script-src-elem'));
  check(!document.body.dataset.inlineScriptRan, 'production CSP still blocks inline scripts');
  await fetch('/result', { method: 'POST', body: JSON.stringify({ passed: true }) });
} catch (error) {
  await fetch('/result', {
    method: 'POST',
    body: JSON.stringify({ error: String(error.stack ?? error) }),
  });
}
