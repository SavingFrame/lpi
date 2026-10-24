function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function until(predicate) {
  for (let i = 0; i < 150; i++) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Split fixture timed out: ${predicate}`);
}

const projectId = 'a'.repeat(64);
const sessionId = '11111111-1111-1111-1111-111111111111';
const sessionPath = `/app/projects/${projectId}/sessions/${sessionId}`;
const stats = async () => (await fetch('/fixture/stats')).json();

async function run() {
  for (const width of [1440, 400]) {
    localStorage.setItem('lpi:diff-opening:v1', 'combined');
    const frame = document.createElement('iframe');
    frame.style.cssText = `border:0;width:${width}px;height:844px;display:block`;
    frame.src = sessionPath;
    document.body.replaceChildren(frame);
    await until(() =>
      frame.contentDocument?.querySelector('[data-message-composer]:not(:disabled)'),
    );
    const doc = frame.contentDocument;
    const editor = doc.querySelector('[data-message-composer]');
    const setValue = Object.getOwnPropertyDescriptor(
      frame.contentWindow.HTMLTextAreaElement.prototype,
      'value',
    ).set;
    setValue.call(editor, 'Keep my unsent split draft');
    editor.dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true }));
    [...doc.querySelectorAll('.workspace-toolbar button')]
      .find((button) => button.textContent.includes('Split Diff'))
      .click();
    await until(() => doc.querySelector('[data-workspace-pane="right"] .diff-page'));
    check(
      doc.querySelector('[data-message-composer]') === editor &&
        editor.value === 'Keep my unsent split draft',
      'Splitting preserves the mounted chat and draft',
    );
    check(
      frame.contentWindow.location.pathname === sessionPath,
      'Splitting does not navigate away from chat',
    );
    const split = doc.querySelector('.split-workspace');
    const left = doc.querySelector('.split-workspace-primary');
    const right = doc.querySelector('.split-workspace-secondary');
    const resize = doc.querySelector('.split-workspace-resize');
    if (width === 1440) {
      check(
        left.getBoundingClientRect().right <= right.getBoundingClientRect().left,
        'Split panes do not overlap',
      );
      const initial = left.getBoundingClientRect().width;
      resize.dispatchEvent(
        new frame.contentWindow.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
      await until(() => left.getBoundingClientRect().width > initial);
      resize.dispatchEvent(
        new frame.contentWindow.KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
      );
      await until(() => Math.abs(left.getBoundingClientRect().width - initial) < 1);
    }
    const choose = async (name) => {
      if (!doc.querySelector('.workspace-panel')) {
        [...doc.querySelectorAll('.workspace-toolbar button')]
          .find((button) => button.textContent.trim() === 'Diff')
          .click();
      }
      await until(() => doc.querySelectorAll('.workspace-diff-file').length === 2);
      [...doc.querySelectorAll('.workspace-diff-file')]
        .find((button) => button.querySelector('.workspace-file-name').textContent === name)
        .click();
    };
    await choose('two.ts');
    await until(() => {
      const section = doc.querySelector('[data-workspace-pane="right"] [data-diff-file="two.ts"]');
      const content = doc.querySelector('[aria-label="Right workspace content"]');
      const header = content?.querySelector('header');
      return (
        section &&
        header &&
        Math.abs(
          section.getBoundingClientRect().top -
            content.getBoundingClientRect().top -
            header.getBoundingClientRect().height,
        ) < 3
      );
    });
    check(
      doc.querySelector('[data-message-composer]') === editor,
      'Right-side file navigation leaves chat mounted',
    );
    if (width === 400) {
      check(
        split.scrollWidth > split.clientWidth,
        'Compact layouts keep both panes reachable through local horizontal scrolling',
      );
      split.scrollLeft = split.scrollWidth;
      await new Promise((resolve) => setTimeout(resolve, 100));
      const beforeComplete = await stats();
      await fetch('/fixture/complete');
      [...doc.querySelectorAll('.session-header button')]
        .find((button) => button.textContent.includes('Refresh'))
        .click();
      await until(async () => (await stats()).snapshots > beforeComplete.snapshots);
      await new Promise((resolve) => setTimeout(resolve, 150));
      check((await stats()).reads === beforeComplete.reads, 'An offscreen chat is not marked read');
      split.scrollLeft = 0;
      await until(async () => (await stats()).reads > beforeComplete.reads);
      frame.remove();
      continue;
    }
    const diffContent = doc.querySelector('[aria-label="Right workspace content"]');
    diffContent.dispatchEvent(
      new frame.contentWindow.WheelEvent('wheel', { deltaY: 24, bubbles: true }),
    );
    diffContent.scrollTop += 24;
    const diffOffset = diffContent.scrollTop;
    await fetch('/fixture/edit');
    for (const socket of frame.contentWindow.diffSockets) {
      socket.onmessage({ data: JSON.stringify({ type: 'diff-changed' }) });
    }
    await until(() =>
      [...diffContent.querySelectorAll('diffs-container')].some((element) =>
        element.shadowRoot?.textContent.includes('updated'),
      ),
    );
    check(
      Math.abs(diffContent.scrollTop - diffOffset) < 1,
      'Live diff updates preserve the reading position',
    );
    check(
      doc.querySelector('[data-message-composer]') === editor,
      'Live diff updates do not remount chat',
    );
    doc.querySelector('.settings-link').click();
    await until(() => doc.querySelector('#diff-opening'));
    const setting = doc.querySelector('#diff-opening');
    setting.value = 'files';
    setting.dispatchEvent(new frame.contentWindow.Event('change', { bubbles: true }));
    await until(() => localStorage.getItem('lpi:diff-opening:v1') === 'files');
    doc.querySelector('[data-workspace-pane="main"] .session-tab-select').click();
    await until(
      () => doc.querySelector('[data-message-composer]')?.value === 'Keep my unsent split draft',
    );
    const restoredEditor = doc.querySelector('[data-message-composer]');
    await choose('two.ts');
    await until(
      () =>
        doc.querySelector('[data-workspace-pane="right"] .diff-page h1')?.textContent === 'two.ts',
    );
    const rightTabs = doc.querySelector('[aria-label="Right workspace tabs"]');
    await choose('one.ts');
    await until(() => rightTabs.querySelectorAll('.session-tab').length === 3);
    [...rightTabs.querySelectorAll('.session-tab-select')]
      .find((button) => button.textContent === 'two.ts')
      .click();
    await until(() => rightTabs.querySelector('.active')?.textContent.includes('two.ts'));
    check(
      rightTabs.querySelectorAll('.session-tab').length === 3,
      'New file tabs join the right group while split',
    );
    rightTabs.querySelector('.session-tab-select').dispatchEvent(
      new frame.contentWindow.MouseEvent('auxclick', {
        button: 1,
        bubbles: true,
        cancelable: true,
      }),
    );
    await until(() => rightTabs.querySelectorAll('.session-tab').length === 2);
    check(
      rightTabs.querySelector('.active')?.textContent.includes('two.ts'),
      'Closing a background tab preserves the selected right tab',
    );
    rightTabs.querySelector('[aria-label="Close one.ts diff"]').click();
    await until(() => rightTabs.querySelectorAll('.session-tab').length === 1);
    check(
      doc.querySelector('[data-message-composer]') === restoredEditor,
      'Closing a right background tab does not remount chat',
    );
    rightTabs.querySelector('.session-tab-select').focus();
    await until(() =>
      doc.querySelector('[data-workspace-pane="right"]').classList.contains('focused'),
    );
    frame.contentWindow.closeActiveTab();
    await until(() => !doc.querySelector('.split-workspace-secondary'));
    check(
      doc.querySelector('[data-message-composer]') === restoredEditor,
      'Close-tab shortcut closes the right group without closing chat',
    );
    await choose('one.ts');
    await until(() => doc.querySelector('main .diff-page h1')?.textContent === 'one.ts');
    doc.querySelector('[aria-label="Move one.ts to right group"]').click();
    await until(
      () =>
        doc.querySelector('[data-workspace-pane="right"] .diff-page h1')?.textContent === 'one.ts',
    );
    await until(
      () => doc.querySelector('[data-message-composer]')?.value === 'Keep my unsent split draft',
    );
    check(
      frame.contentWindow.location.pathname === sessionPath,
      'Moving a main diff right restores the last chat',
    );
    doc.querySelector('[aria-label="Move one.ts to main group"]').click();
    await until(
      () =>
        !doc.querySelector('.split-workspace-secondary') &&
        doc.querySelector('main .diff-page h1')?.textContent === 'one.ts',
    );
    check(
      doc.querySelectorAll('.session-tab').length === 2,
      'Moving tabs between groups does not duplicate them',
    );
    frame.remove();
  }
}

run().then(
  () => fetch('/result', { method: 'POST', body: JSON.stringify({ passed: true }) }),
  (error) => fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack }) }),
);
