import { createElement as h, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { ChatSearch } from '../../src/session/transcript/chat-search';
import { conversationRanges } from '../../src/session/transcript/conversation-ranges';
import { MessageBody } from '../../src/session/transcript/message-content';
import '../../src/style.css';

async function run() {
  const host = document.createElement('main');
  host.style.cssText = 'height:400px;overflow:auto';
  document.body.append(host);
  const root = createRoot(host);
  let navigations = 0;
  function App({ reply = 'A **needle** reply. needle [x].' }) {
    const pane = useRef(null);
    const trigger = useRef(null);
    const [open, setOpen] = useState(false);
    return h(
      'div',
      { ref: pane },
      h(
        'div',
        { className: 'session-topbar' },
        h('button', { type: 'button', ref: trigger, onClick: () => setOpen(!open) }, 'Search'),
        h(ChatSearch, {
          pane,
          trigger,
          open,
          onOpenChange: setOpen,
          onNavigate: () => navigations++,
        }),
      ),
      h(
        'section',
        { className: 'transcript' },
        h(MessageBody, { item: { role: 'user', content: 'NEEDLE [x].' } }),
        h('div', { style: { height: 800 } }),
        h(MessageBody, {
          item: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'needle secret reasoning' },
              { type: 'text', text: reply },
              { type: 'toolCall', name: 'bash', arguments: { command: 'needle' } },
            ],
          },
        }),
        h(MessageBody, { item: { role: 'toolResult', content: 'needle output' } }),
      ),
    );
  }
  const render = (reply) => flushSync(() => root.render(h(App, { reply })));
  const check = (value, message) => {
    if (!value) {
      throw new Error(message);
    }
  };
  const click = (label) => flushSync(() => host.querySelector(`[aria-label="${label}"]`).click());
  const key = (target, key, modifiers = {}) =>
    flushSync(() =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
      ),
    );
  const query = (value) => {
    const input = host.querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    flushSync(() => input.dispatchEvent(new Event('input', { bubbles: true })));
  };
  const status = () => host.querySelector('.chat-search [role="status"]').textContent;
  render();
  key(window, 'f', { ctrlKey: true });
  check(document.activeElement === host.querySelector('input'), 'Ctrl+F focuses search');
  query('needle');
  check(status() === '1 of 3', `only messages and replies match: ${status()}`);
  check(CSS.highlights.get('chat-search').size === 3, 'all occurrences highlighted');
  check(CSS.highlights.get('chat-search-active').size === 1, 'active match highlighted separately');
  click('Next match');
  check(status() === '2 of 3' && host.scrollTop > 0, 'next scrolls to the reply');
  key(host.querySelector('input'), 'Enter', { shiftKey: true });
  check(status() === '1 of 3', 'Shift+Enter navigates backward');
  click('Previous match');
  check(status() === '3 of 3', 'previous wraps');
  query('[x].');
  check(status() === '1 of 2', 'query punctuation is literal');
  query('a needle reply');
  check(status() === '1 of 1', 'search spans Markdown nodes');
  const range = conversationRanges(host, 'a needle reply')[0];
  check(range.toString() === 'A needle reply', 'range covers the rendered formatted text');
  query('not present');
  check(status() === 'No matches', 'empty results reported');
  check(
    host.querySelector('[aria-label="Next match"]').disabled,
    'navigation disabled without matches',
  );
  query('needle');
  render('needle needle needle');
  await new Promise((resolve) => setTimeout(resolve, 50));
  check(status().endsWith('of 4'), `streamed text refreshes matches: ${status()}`);
  host.style.width = '360px';
  render(`needle ${'filler '.repeat(3000)} needle`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  click('Next match');
  const firstReplyMatch = host.scrollTop;
  click('Next match');
  check(
    host.scrollTop > firstReplyMatch + 400,
    'navigation reaches occurrences within a long paragraph',
  );
  const searchBounds = host.querySelector('.chat-search').getBoundingClientRect();
  const closeBounds = host
    .querySelector('[aria-label="Close chat search"]')
    .getBoundingClientRect();
  check(closeBounds.right <= searchBounds.right, 'controls fit a compact chat pane');
  key(host.querySelector('input'), 'Escape');
  check(!host.querySelector('input'), 'Escape closes search');
  check(document.activeElement.textContent === 'Search', 'close restores trigger focus');
  check(!CSS.highlights.has('chat-search'), 'close removes highlights');
  key(window, 'f', { metaKey: true });
  check(document.activeElement === host.querySelector('input'), 'Cmd+F opens search');
  check(navigations > 0, 'navigation pauses scroll following');
  root.unmount();
  check(!CSS.highlights.has('chat-search-active'), 'unmount removes active highlight');
}
run()
  .then(() => {
    document.body.dataset.result = 'passed';
  })
  .catch((error) => {
    document.body.dataset.result = String(error.stack ?? error);
  });
