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
    await until(() => frame.contentDocument?.querySelectorAll('.project-group').length === 80);
    const frameDocument = frame.contentDocument;
    const sidebar = frameDocument.querySelector('.sidebar');
    const navigation = sidebar.querySelector('nav');
    const settings = sidebar.querySelector('.settings-link');
    const viewport = frame.contentWindow.innerHeight;
    const context = `${width}x${height}, desktop=${desktop}`;
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
    navigation.scrollTop = navigation.scrollHeight;
    await new Promise((resolve) => frame.contentWindow.requestAnimationFrame(resolve));
    const after = settings.getBoundingClientRect();
    check(
      Math.abs(before.top - after.top) < 1,
      `Settings must not scroll with projects: ${context}`,
    );
    check(sidebar.scrollTop === 0, `Sidebar itself must not scroll: ${context}`);
    const last = frameDocument.querySelector('.project-group:last-child').getBoundingClientRect();
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
}

run().then(
  () => fetch('/result', { method: 'POST', body: JSON.stringify({ passed: true }) }),
  (error) => fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack }) }),
);
