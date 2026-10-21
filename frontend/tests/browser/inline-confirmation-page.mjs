import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { ConfirmButton } from '../../src/components/confirm-button';
import '../../src/style.css';

try {
  let calls = 0;
  const host = document.createElement('main');
  document.body.append(host);
  const root = createRoot(host);
  const render = (
    disabled = false,
    message = 'Active work will be interrupted. Saved history stays.',
  ) =>
    flushSync(() =>
      root.render(
        createElement(
          ConfirmButton,
          {
            message,
            confirmLabel: message ? 'Stop runtime' : 'Stop',
            destructive: true,
            disabled,
            onConfirm: () => calls++,
          },
          'Stop runtime',
        ),
      ),
    );
  const check = (value, message) => {
    if (!value) {
      throw new Error(message);
    }
  };
  const click = (button) => flushSync(() => button.click());
  render();
  const trigger = host.querySelector('button');
  check(!host.querySelector('fieldset'), 'confirmation starts hidden');
  click(trigger);
  check(calls === 0, 'opening must not execute the action');
  const group = host.querySelector('fieldset');
  check(group.textContent.includes('Saved history stays'), 'warning is visible');
  check(document.activeElement.textContent === 'Cancel', 'Cancel receives initial focus');
  check(trigger.getAttribute('aria-expanded') === 'true', 'trigger exposes expanded state');
  click(group.querySelector('button'));
  check(!host.querySelector('fieldset') && calls === 0, 'Cancel has no side effects');
  check(document.activeElement === trigger, 'Cancel restores focus');
  click(trigger);
  flushSync(() =>
    document.activeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  check(!host.querySelector('fieldset') && calls === 0, 'Escape cancels');
  check(document.activeElement === trigger, 'Escape restores focus');
  click(trigger);
  render(true);
  check(!host.querySelector('fieldset'), 'unavailable actions dismiss confirmation');
  render();
  check(!host.querySelector('fieldset'), 'availability does not restore stale consent');
  click(trigger);
  click(host.querySelector('fieldset button:last-child'));
  check(calls === 1 && !host.querySelector('fieldset'), 'explicit confirmation executes once');
  click(trigger);
  check(calls === 1, 'next action requires fresh confirmation');
  click(host.querySelector('fieldset button'));
  render(false, null);
  const before = host.firstElementChild.getBoundingClientRect();
  click(trigger);
  const after = host.firstElementChild.getBoundingClientRect();
  check(!host.querySelector('p'), 'compact confirmation has no message');
  check(getComputedStyle(trigger).visibility === 'hidden', 'compact confirmation replaces trigger');
  check(before.height === after.height, 'compact confirmation keeps its height');
  check(before.width === after.width, 'compact confirmation keeps its width');
  click(host.querySelector('fieldset button'));
  check(document.activeElement === trigger, 'compact Cancel restores trigger focus');
  check(getComputedStyle(trigger).visibility === 'visible', 'Cancel restores compact trigger');
  click(trigger);
  click(host.querySelector('fieldset button:last-child'));
  check(calls === 2, 'compact confirmation executes only after Stop');
  root.unmount();
  document.body.dataset.result = 'passed';
} catch (error) {
  document.body.dataset.result = String(error.stack ?? error);
}
