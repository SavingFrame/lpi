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
      check(!settings, 'Browser must not expose native settings');
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
}

run().then(
  () => fetch('/result', { method: 'POST', body: JSON.stringify({ passed: true }) }),
  (error) => fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack }) }),
);
