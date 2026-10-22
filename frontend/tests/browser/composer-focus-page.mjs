import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Composer } from '../../src/session/composer.tsx';
import '../../src/styles/composer.css';

try {
  const container = document.createElement('div');
  const other = document.createElement('button');
  other.textContent = 'Other control';
  document.body.append(other, container);
  const root = createRoot(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const render = (id, props = {}) => {
    flushSync(() => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(Composer, {
            key: id,
            id,
            projectId: 'test',
            onNew: async () => false,
            snapshot: null,
            active: false,
            previewing: false,
            restoredDraft: null,
            pending: false,
            uncertain: false,
            outcome: null,
            following: true,
            onFollow: () => {},
            onCommand: async () => false,
            ...props,
          }),
        ),
      );
    });
  };
  const check = (condition, message) => {
    if (!condition) {
      throw new Error(message);
    }
  };
  const input = () => container.querySelector('textarea');
  render('first');
  check(document.activeElement === input(), 'Opening a session must focus the composer');
  other.focus();
  render('first', { active: true });
  check(document.activeElement === other, 'Live updates must not steal focus');
  render('second');
  check(document.activeElement === input(), 'Switching sessions must focus the new composer');
  other.focus();
  render('preview', { previewing: true });
  check(input().disabled, 'Branch previews must remain read-only');
  check(document.activeElement === other, 'A disabled preview must not steal focus');
  const sent = [];
  const nativeFetch = window.fetch.bind(window);
  const fileQueries = [];
  let finishFileSearch;
  window.fetch = async (path, options) => {
    if (!String(path).startsWith('/projects/test/files')) {
      return nativeFetch(path, options);
    }
    const query = new URL(path, location.href).searchParams.get('query');
    fileQueries.push(query);
    if (query === 'src/read') {
      await new Promise((resolve) => {
        finishFileSearch = resolve;
      });
    }
    return new Response(
      JSON.stringify({
        entries: [
          {
            path: query === 'src/read' ? 'src/readme.md' : 'deep/project/README.md',
            directory: false,
          },
        ],
        truncated: false,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  };
  const waitFor = async (predicate) => {
    for (let i = 0; i < 100; i++) {
      if (predicate()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Composer condition timed out');
  };
  const type = (text) => {
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
        input(),
        text,
      );
      input().setSelectionRange(text.length, text.length);
      input().dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const key = (value, options = {}) =>
    flushSync(() =>
      input().dispatchEvent(
        new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options }),
      ),
    );
  render('commands', {
    active: true,
    onCommand: async (command) => {
      sent.push(command);
      return true;
    },
  });
  type('/');
  await waitFor(() => container.querySelectorAll('[role=option]').length === 2);
  key('ArrowDown');
  key('Tab');
  check(input().value === '/new ', 'Arrow navigation and Tab must select the highlighted command');
  type('/compact Keep decisions');
  await waitFor(() => !container.querySelector('button[type=submit]').disabled);
  key('Enter', { altKey: true });
  await waitFor(() => sent.length === 1);
  check(
    sent[0].type === 'compact' && sent[0].instructions === 'Keep decisions',
    'Compact must use structured dispatch',
  );
  type('/files');
  check(!container.querySelector('[role=option]'), 'Pim must not offer the removed /files command');
  type('Review @REA');
  await waitFor(() => container.querySelector('[role=option]'));
  check(fileQueries.at(-1) === 'REA', 'References must search the project using the full query');
  const fileList = container.querySelector('[role=listbox]');
  const previousRow = fileList.querySelector('[role=option]');
  type('Review @src/read');
  check(
    container.querySelector('[role=listbox]') === fileList && fileList.contains(previousRow),
    'Typing must preserve the menu and previous rows during debounce',
  );
  key('Tab');
  check(input().value === 'Review @src/read', 'Tab must not insert stale results during debounce');
  await waitFor(() => Boolean(finishFileSearch));
  check(
    container.querySelector('[role=listbox]') === fileList && fileList.contains(previousRow),
    'The menu must remain populated during the network request',
  );
  check(
    fileList.getAttribute('aria-busy') === 'true',
    'Pending search must be exposed without clearing the menu',
  );
  key('Enter');
  previousRow.querySelector('button').click();
  check(
    input().value === 'Review @src/read',
    'Keyboard and mouse must not insert stale results while loading',
  );
  finishFileSearch();
  await waitFor(() => fileList.getAttribute('aria-busy') === 'false');
  check(
    container.querySelector('[role=listbox]') === fileList,
    'New results must update the existing menu without remounting it',
  );
  check(
    fileList.textContent.includes('src/readme.md'),
    'The new response must replace the old paths',
  );
  key('Tab');
  check(
    input().value === 'Review @src/readme.md ',
    'File completion must insert the full project path without folder-by-folder navigation',
  );
  type('/');
  key('Escape');
  check(!container.querySelector('[role=listbox]'), 'Escape must dismiss suggestions');
  check(sent.length === 1, 'Dismissing suggestions must not abort Pi');
  const snapshot = {
    session: { connection: 'connected' },
    state: {
      commands: Array.from({ length: 20 }, (_, index) => ({
        name: `session-breakdown-${index}`,
        description:
          'Interactive breakdown of last 7/30/90 days of session usage with a deliberately long description',
        source: 'extension',
      })),
    },
    controls: {
      availableModels: [],
      scopedModels: [],
      model: null,
      thinkingLevel: null,
      availableThinkingLevels: [],
      contextUsage: null,
    },
    view: { running: false, compacting: false },
  };
  render('layout', { active: true, snapshot });
  container.style.width = '600px';
  type('/');
  const list = container.querySelector('[role=listbox]');
  check(
    list.clientHeight <= 140 && list.scrollHeight > list.clientHeight,
    `Menu must be bounded to five compact rows (height=${list.clientHeight}, scroll=${list.scrollHeight}, rows=${list.children.length}, max=${getComputedStyle(list).maxHeight})`,
  );
  const visible = () => {
    const row = list.querySelector('[aria-selected=true]').getBoundingClientRect();
    const bounds = list.getBoundingClientRect();
    check(
      row.top >= bounds.top - 1 && row.bottom <= bounds.bottom + 1,
      'Arrow selection must remain visible',
    );
  };
  const pageTop = document.scrollingElement.scrollTop;
  for (let index = 0; index < 15; index++) {
    key('ArrowDown', { repeat: index > 0 });
    visible();
  }
  check(list.scrollTop > 0, 'Arrow navigation must scroll the menu');
  for (let index = 0; index < 15; index++) {
    key('ArrowUp');
    visible();
  }
  check(list.scrollTop === 0, 'Up navigation must scroll back to the first row');
  key('ArrowUp');
  visible();
  key('ArrowDown');
  visible();
  check(list.scrollTop === 0, 'Wrapping to the first option must reset menu scroll');
  check(
    document.scrollingElement.scrollTop === pageTop,
    'Menu navigation must not scroll the page',
  );
  for (const width of ['600px', '320px']) {
    container.style.width = width;
    const row = list.children[2];
    const button = row.querySelector('button');
    const name = row.querySelector('strong');
    const description = row.querySelector('span');
    check(
      button.getBoundingClientRect().height === 28,
      'Long command names must not increase row height',
    );
    check(getComputedStyle(name).whiteSpace === 'nowrap', 'Command names must not wrap');
    check(description.scrollWidth > description.clientWidth, 'Long descriptions must truncate');
    check(list.scrollWidth === list.clientWidth, 'Menu must not overflow horizontally');
    check(
      button.title.includes('native terminal'),
      'Extension warning must remain available in the tooltip',
    );
  }
  root.unmount();
  queryClient.clear();
  await fetch('/result', { method: 'POST', body: JSON.stringify({ passed: true }) });
} catch (error) {
  await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack }) });
}
