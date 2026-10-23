function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Sidebar fixture did not become ready');
}

async function run() {
  for (const [width, height, desktop] of [
    [1280, 800, true],
    [900, 400, true],
    [640, 450, true],
    [390, 844, true],
    [1280, 800, false],
  ]) {
    const frame = document.createElement('iframe');
    frame.style.cssText = `border:0;width:${width}px;height:${height}px;display:block`;
    frame.src = desktop ? '/' : '/?browser=1';
    document.body.replaceChildren(frame);
    await until(() => frame.contentDocument?.querySelector('.session-item'));
    const frameDocument = frame.contentDocument;
    const sidebar = frameDocument.querySelector('.sidebar');
    const navigation = sidebar.querySelector('nav');
    const settings = sidebar.querySelector('.settings-link');
    const viewport = frame.contentWindow.innerHeight;
    const context = `${width}x${height}, desktop=${desktop}`;
    check(
      frameDocument.querySelectorAll('.session-item').length < 40,
      `Bounded initial rows: ${context}`,
    );
    frameDocument.body.dispatchEvent(
      new frame.contentWindow.KeyboardEvent('keydown', {
        key: 'p',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await until(() => frameDocument.querySelector('.keyboard-dialog[open]'));
    const palette = frameDocument.querySelector('.keyboard-dialog[open]');
    const bounds = palette.getBoundingClientRect();
    check(
      Math.abs(bounds.left + bounds.width / 2 - frame.contentWindow.innerWidth / 2) < 1 &&
        Math.abs(bounds.top + bounds.height / 2 - viewport / 2) < 1,
      `Command palette must be centered in the window: ${context}`,
    );
    check(
      bounds.left >= 0 &&
        bounds.right <= frame.contentWindow.innerWidth &&
        bounds.top >= 0 &&
        bounds.bottom <= viewport,
      `Command palette must fit the window: ${context}`,
    );
    palette.close();
    const firstProject = frameDocument.querySelector('.project-toggle');
    firstProject.click();
    await until(() => firstProject.getAttribute('aria-expanded') === 'false');
    check(
      !frameDocument.querySelector(
        '[data-window-key="session:11111111-1111-1111-1111-000000000000"]',
      ),
      `Collapsed rows unmount: ${context}`,
    );
    firstProject.click();
    await until(() => firstProject.getAttribute('aria-expanded') === 'true');
    const scope = frameDocument.querySelector('.project-scope');
    scope.click();
    await until(() => scope.getAttribute('aria-pressed') === 'true');

    if (width === 1280 && desktop) {
      const pin = frameDocument.querySelector('.project-pin');
      pin.click();
      await until(() => pin.getAttribute('aria-pressed') === 'true');
      const pinnedId = pin.closest('.project-group').dataset.projectId;
      await until(() =>
        Object.values(frame.contentWindow.localStorage).includes(JSON.stringify([pinnedId])),
      );
      const input = frameDocument.querySelector('input[type="search"]');
      input.focus();
      const setValue = Object.getOwnPropertyDescriptor(
        frame.contentWindow.HTMLInputElement.prototype,
        'value',
      ).set;
      setValue.call(input, 'Session');
      input.dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true }));
      await until(() => !frameDocument.querySelector('.project-scope'));
      check(
        frameDocument.querySelector('.session-visibility button').textContent.includes('1200'),
        'Global search covers all history',
      );
      check(
        frameDocument.querySelectorAll('.session-item').length < 40,
        'Search results remain windowed',
      );
      check(frameDocument.activeElement === input, 'Deferred results preserve search focus');
      frameDocument.querySelector('.shell').style.setProperty('--sidebar-width', '500px');
      await new Promise((resolve) => setTimeout(resolve, 100));
      const visibleRows = [...frameDocument.querySelectorAll('.windowed-row')];
      for (let index = 1; index < visibleRows.length; index++) {
        check(
          visibleRows[index].getBoundingClientRect().top >=
            visibleRows[index - 1].getBoundingClientRect().bottom - 1,
          'Measured rows do not overlap after width changes',
        );
      }
      const list = frameDocument.querySelector('.windowed-list');
      const lastRow = list.lastElementChild;
      const position = Number(lastRow.dataset.windowIndex);
      const targets = lastRow.querySelectorAll('a[href],button:not(:disabled),summary');
      const target = targets[targets.length - 1];
      target.focus();
      target.dispatchEvent(
        new frame.contentWindow.KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
        }),
      );
      await until(
        () =>
          Number(
            frameDocument.activeElement.closest('[data-window-index]')?.dataset.windowIndex,
          ) ===
          position + 1,
      );
      const focused = frameDocument.activeElement;
      focused.dispatchEvent(
        new frame.contentWindow.KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
          cancelable: true,
        }),
      );
      await until(
        () =>
          Number(
            frameDocument.activeElement.closest('[data-window-index]')?.dataset.windowIndex,
          ) ===
          position + 2,
      );
      const keyboard = (key, options = {}) =>
        frameDocument.activeElement.dispatchEvent(
          new frame.contentWindow.KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
            ...options,
          }),
        );
      keyboard('l', { ctrlKey: true });
      await until(() => frameDocument.activeElement === frameDocument.querySelector('main'));
      keyboard('h', { ctrlKey: true });
      await until(
        () =>
          Number(
            frameDocument.activeElement.closest('[data-window-index]')?.dataset.windowIndex,
          ) ===
          position + 2,
      );
      keyboard('k', { ctrlKey: true });
      await until(() => frameDocument.activeElement === input);
      setValue.call(input, '');
      input.dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true }));
      await until(() => frameDocument.querySelector('.project-scope'));
    }
    check(
      navigation.scrollHeight > navigation.clientHeight,
      `Project list must scroll: ${context}`,
    );
    check(
      navigation.clientHeight > 20,
      `Project list has usable height: ${context}, nav=${navigation.clientHeight}, sidebar=${sidebar.clientHeight}, children=${Array.from(sidebar.children, (child) => `${child.className}:${child.getBoundingClientRect().height}`).join(',')}`,
    );
    if (!desktop) {
      check(!frameDocument.querySelector('.session-tabs'), 'Browser does not show session tabs');
      check(settings, 'Browser must expose shared keyboard settings');
      frame.remove();
      continue;
    }

    const before = settings.getBoundingClientRect();
    check(before.top >= 0 && before.bottom <= viewport, `Settings initially visible: ${context}`);
    for (let attempt = 0; attempt < 5; attempt++) {
      navigation.scrollTop = navigation.scrollHeight;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await until(() => frameDocument.querySelector('[data-window-key="more:79"]'));
    const after = settings.getBoundingClientRect();
    check(
      Math.abs(before.top - after.top) < 1,
      `Settings must not scroll with projects: ${context}`,
    );
    check(sidebar.scrollTop === 0, `Sidebar itself must not scroll: ${context}`);
    const last = frameDocument.querySelector('[data-window-key="more:79"]').getBoundingClientRect();
    const navBounds = navigation.getBoundingClientRect();
    check(last.bottom <= navBounds.bottom + 1, `Last project remains reachable: ${context}`);
    const target = frameDocument.elementFromPoint(
      after.left + after.width / 2,
      after.top + after.height / 2,
    );
    check(
      settings === target || settings.contains(target),
      `Settings is not clipped or covered: ${context}`,
    );
    settings.click();
    await until(() => frameDocument.querySelector('.settings-page h1')?.textContent === 'Settings');
    check(frameDocument.querySelector('#keyboard-heading'), 'Keyboard settings must be available');
    if (width === 1280) {
      const record = frameDocument.querySelector(
        'button[aria-label="Change Focus left pane shortcut"]',
      );
      record.click();
      await until(() => record.textContent.includes('Press keys'));
      record.dispatchEvent(
        new frame.contentWindow.KeyboardEvent('keydown', {
          key: 'l',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await until(() =>
        frameDocument.querySelector('[role="alert"]')?.textContent.includes('already assigned'),
      );
      record.dispatchEvent(
        new frame.contentWindow.KeyboardEvent('keydown', {
          key: 'y',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await until(() => record.textContent === 'Ctrl+Shift+y');
      check(
        !frameDocument.querySelector('[role="alert"]'),
        'A valid assignment clears the conflict',
      );
      frame.contentWindow.location.reload();
      await until(
        () =>
          frame.contentDocument?.querySelector(
            'button[aria-label="Change Focus left pane shortcut"]',
          )?.textContent === 'Ctrl+Shift+y',
      );
      const reset = [...frame.contentDocument.querySelectorAll('button')].find(
        (button) => button.textContent === 'Restore keyboard defaults',
      );
      reset.click();
      await until(
        () =>
          frame.contentDocument.querySelector(
            'button[aria-label="Change Focus left pane shortcut"]',
          )?.textContent === 'Ctrl+h',
      );
    }
    const settingsDocument = frame.contentDocument;
    const recorder = settingsDocument.querySelector('[data-shortcut-recorder]');
    recorder.click();
    await until(() => recorder.textContent.includes('Press keys'));
    recorder.dispatchEvent(
      new frame.contentWindow.KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    await until(() => !recorder.textContent.includes('Press keys'));
    check(
      settingsDocument.querySelector('.settings-page'),
      'Escape cancels recording before leaving Settings',
    );
    settingsDocument.body.dispatchEvent(
      new frame.contentWindow.KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    await until(() => !frame.contentDocument.querySelector('.settings-page'));
    check(
      frame.contentDocument.querySelector('.welcome'),
      'Escape returns to the page before Settings',
    );
    frame.remove();
  }
  for (const width of [1280, 390]) {
    const frame = document.createElement('iframe');
    frame.style.cssText = `border:0;width:${width}px;height:844px;display:block`;
    frame.src = '/app/projects/0/sessions/11111111-1111-1111-1111-000000000000?header=1';
    document.body.replaceChildren(frame);
    await until(() =>
      frame.contentDocument?.querySelector('.session-header-status')?.textContent.includes('idle'),
    );
    const doc = frame.contentDocument;
    const status = doc.querySelector('.session-header-status [role="status"]');
    await until(() => status.textContent === '');
    const bounds = () => ({
      header: doc.querySelector('.session-header').getBoundingClientRect().height,
      topbar: doc.querySelector('.session-topbar').getBoundingClientRect().height,
      transcript:
        doc.querySelector('.transcript').getBoundingClientRect().top +
        doc.querySelector('main').scrollTop,
    });
    const before = bounds();
    frame.contentWindow.holdSnapshots = true;
    [...doc.querySelectorAll('.session-header button')]
      .find((button) => button.textContent.includes('Refresh'))
      .click();
    await until(() => status.textContent.includes('Updating'));
    check(
      !doc.querySelector('.session-topbar > .muted'),
      'Synchronization does not create a separate row',
    );
    const during = bounds();
    frame.contentWindow.holdSnapshots = false;
    frame.contentWindow.releaseSnapshots();
    await until(() => status.textContent === '');
    const after = bounds();
    for (const key of ['header', 'topbar', 'transcript']) {
      check(
        Math.abs(before[key] - during[key]) < 1 && Math.abs(before[key] - after[key]) < 1,
        `Synchronization does not shift ${key} at ${width}px`,
      );
    }
    frame.remove();
  }
  const frame = document.createElement('iframe');
  frame.style.cssText = 'border:0;width:1280px;height:800px;display:block';
  frame.src = '/';
  document.body.replaceChildren(frame);
  await until(() => frame.contentDocument?.querySelectorAll('.session-link').length > 1);
  const doc = frame.contentDocument;
  const links = [...doc.querySelectorAll('.session-link')].slice(0, 2);
  const firstPath = new URL(links[0].href).pathname;
  const secondPath = new URL(links[1].href).pathname;
  links[0].click();
  await until(() => doc.querySelectorAll('.session-tab').length === 1);
  await until(() => doc.querySelector('[data-message-composer]'));
  const editor = doc.querySelector('[data-message-composer]');
  const setValue = Object.getOwnPropertyDescriptor(
    frame.contentWindow.HTMLTextAreaElement.prototype,
    'value',
  ).set;
  setValue.call(editor, 'Keep this unsent tab draft');
  editor.dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true }));
  links[1].click();
  await until(() => doc.querySelectorAll('.session-tab').length === 2);
  await until(() => frame.contentWindow.location.pathname === secondPath);
  check(
    doc.querySelector('.session-tab-status.status-unknown') &&
      doc.querySelector('.session-tab-select').title.includes('Disconnected'),
    'Disconnected tabs expose a muted status indicator and tooltip',
  );
  const backgroundClose = doc.querySelector('.session-tab-close');
  check(
    frame.contentWindow.getComputedStyle(backgroundClose).opacity ===
      (frame.contentWindow.matchMedia('(hover: none)').matches ? '1' : '0'),
    'Inactive tab close button is hidden on hover-capable devices',
  );
  backgroundClose.focus();
  check(
    frame.contentWindow.getComputedStyle(backgroundClose).opacity === '1',
    'Keyboard focus reveals the inactive tab close button',
  );
  doc.querySelector('.session-tab-select').click();
  await until(() => frame.contentWindow.location.pathname === firstPath);
  await until(
    () => doc.querySelector('[data-message-composer]')?.value === 'Keep this unsent tab draft',
  );
  links[0].click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  check(
    doc.querySelectorAll('.session-tab').length === 2,
    'Opening an existing session deduplicates tabs',
  );
  doc.querySelectorAll('.session-tab-select')[1].dispatchEvent(
    new frame.contentWindow.MouseEvent('auxclick', {
      button: 1,
      bubbles: true,
      cancelable: true,
    }),
  );
  await until(() => doc.querySelectorAll('.session-tab').length === 1);
  check(
    frame.contentWindow.location.pathname === firstPath,
    'Middle-click closes a background tab without activating it',
  );
  frame.contentWindow.closeSessionTab();
  await until(() => doc.querySelector('.welcome') && !doc.querySelector('.session-tab'));
  check(doc.querySelector('.sidebar'), 'Closing the final tab leaves the session sidebar');
  const tabs = [firstPath, secondPath].map((path) => ({
    projectId: 'a'.repeat(64),
    sessionId: path.split('/').at(-1),
  }));
  frame.contentWindow.localStorage.setItem(
    `lpi:desktop-tabs:v1:${frame.contentWindow.location.origin}`,
    JSON.stringify({ tabs, active: tabs[1].sessionId }),
  );
  frame.contentWindow.location.reload();
  await until(() => frame.contentWindow.location.pathname.endsWith(tabs[1].sessionId));
  await until(() => frame.contentDocument.querySelectorAll('.session-tab').length === 2);
  check(
    frame.contentDocument.querySelectorAll('.session-tab')[1].classList.contains('active'),
    'Restart restores the working set and active tab',
  );
  frame.remove();
}

run().then(
  () => fetch('/result', { method: 'POST', body: JSON.stringify({ passed: true }) }),
  (error) => fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack }) }),
);
