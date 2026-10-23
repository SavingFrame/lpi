import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { drafts } from '../../src/client/controllers';
import { Composer } from '../../src/session/composer/composer';
import '../../src/style.css';

void (async () => {
  try {
    const check = (condition, message) => {
      if (!condition) {
        throw new Error(message);
      }
    };
    const host = document.createElement('main');
    host.style.width = '340px';
    document.body.append(host);
    const root = createRoot(host);
    const commands = [];
    const controller = drafts.get('pending-queue-test');
    await controller.initialize();
    controller.update(() => ({ text: 'unsent draft', images: [] }));
    const queue = { revision: 'first', steering: ['change direction'], followUp: ['afterwards'] };
    let snapshot = {
      session: { id: 'pending-queue-test', generation: 1, connection: 'connected' },
      state: { hasPendingMessages: true, queue },
      view: { running: true, compacting: false },
      controls: {
        model: null,
        availableModels: [],
        scopedModels: [],
        thinkingLevel: 'off',
        availableThinkingLevels: [],
        contextUsage: null,
      },
    };
    const render = (active = true) =>
      flushSync(() =>
        root.render(
          createElement(Composer, {
            id: 'pending-queue-test',
            snapshot,
            active,
            previewing: false,
            restoredDraft: null,
            pending: false,
            uncertain: false,
            outcome: null,
            following: true,
            onFollow() {},
            onCommand: async (command) => {
              commands.push(command);
              return true;
            },
          }),
        ),
      );
    const click = (button) => flushSync(() => button.click());
    const button = (text) =>
      [...host.querySelectorAll('button')].find((item) => item.textContent === text);
    render();
    check(host.textContent.includes('change direction'), 'native steer text is visible');
    check(host.textContent.includes('afterwards'), 'native follow-up text is visible');
    click(button('Copy text to draft'));
    check(
      host.querySelector('textarea').value === 'unsent draft\n\nchange direction',
      'copy preserves and appends to unsent draft',
    );
    check(commands.length === 0, 'copy never sends or clears');
    snapshot = {
      ...snapshot,
      state: { ...snapshot.state, queue: { ...queue, revision: 'newer' } },
    };
    render();
    click(button('Clear queued messages'));
    check(!host.querySelector('section fieldset'), 'clear does not ask for confirmation');
    check(
      commands.length === 1 &&
        commands[0].type === 'clear_queue' &&
        commands[0].expectedRevision === 'newer',
      'one click clears the displayed queue revision',
    );
    check(
      host.querySelector('textarea').value.includes('unsent draft'),
      'clearing does not erase the draft',
    );
    render(false);
    check(button('Clear queued messages').disabled, 'unsynchronized commands are disabled');
    snapshot = { ...snapshot, state: { ...snapshot.state, queue: null } };
    render();
    check(
      !button('Clear queued messages') && host.textContent.includes('queue access is unavailable'),
      'uncaptured queues cannot be cleared',
    );
    snapshot = {
      ...snapshot,
      state: {
        ...snapshot.state,
        queue: {
          ...queue,
          steering: Array.from({ length: 20 }, (_, i) => `${i}: ${'long message '.repeat(20)}`),
        },
      },
    };
    render();
    const list = host.querySelector('section[aria-label="Queued messages"] > div:last-child');
    check(
      list.scrollHeight > list.clientHeight && list.clientHeight <= 192,
      'queue remains scrollable and height-bounded',
    );
    check(host.scrollWidth <= host.clientWidth, 'queue wraps at narrow widths');
    snapshot = { ...snapshot, session: { ...snapshot.session, connection: 'disconnected' } };
    render(false);
    check(
      !host.querySelector('section[aria-label="Queued messages"]'),
      'disconnected snapshots never present a live queue',
    );
    root.unmount();
    document.body.dataset.result = 'passed';
  } catch (error) {
    document.body.dataset.result = String(error.stack ?? error);
  }
})();
