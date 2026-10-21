import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Composer } from '../../src/session/composer.tsx';

try {
  const container = document.createElement('div');
  const other = document.createElement('button');
  other.textContent = 'Other control';
  document.body.append(other, container);
  const root = createRoot(container);
  const render = (id, props = {}) => {
    flushSync(() => {
      root.render(
        createElement(Composer, {
          key: id,
          id,
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
  root.unmount();
  await fetch('/result', { method: 'POST', body: JSON.stringify({ passed: true }) });
} catch (error) {
  await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack }) });
}
