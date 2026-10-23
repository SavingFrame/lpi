import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { bundledResponse } from '../../dist/desktop/protocol.js';
import { DESKTOP_ORIGIN, DESKTOP_SCHEME } from '../../dist/src/shared/desktop.js';
import '../../dist/desktop/main.js';

const deadline = setTimeout(() => {
  console.error('Desktop smoke timed out');
  app.exit(1);
}, 20000);

async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (await check()) {
      return;
    }
    await delay(50);
  }
  throw new Error('Condition did not become true');
}

app.once('browser-window-created', (_event, window) => {
  void (async () => {
    const contents = window.webContents;
    console.log('smoke: window created');
    await once(contents, 'did-finish-load');
    console.log('smoke: frontend loaded');
    if (process.env.PIM_SMOKE_OFFLINE === '1') {
      await until(() =>
        contents.executeJavaScript(
          'Boolean(document.querySelector(".welcome h1")) && document.querySelector("[role=status]")?.textContent === "offline"',
        ),
      );
      assert.equal(contents.getURL(), `${DESKTOP_ORIGIN}/`);
      console.log('DESKTOP_OFFLINE_OK');
      clearTimeout(deadline);
      window.close();
      return;
    }
    await until(() =>
      contents.executeJavaScript(
        "document.querySelector('[role=status]')?.textContent === 'ready'",
      ),
    );
    assert.deepEqual(
      await contents.executeJavaScript('[typeof require, typeof process, typeof window.electron]'),
      ['undefined', 'undefined', 'undefined'],
    );
    const preferences = contents.getLastWebPreferences();
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.webSecurity, true);
    assert.equal(preferences.webviewTag, false);
    assert.equal(
      await contents.executeJavaScript(
        "navigator.permissions.query({ name: 'geolocation' }).then(result => result.state)",
      ),
      'denied',
    );

    assert.equal(contents.getURL(), `${DESKTOP_ORIGIN}/`);
    // Cross-origin API and event-socket traffic has loaded the actual React UI.
    assert.match(await contents.executeJavaScript('document.body.innerText'), /test/);
    const mutation = await contents.executeJavaScript(`
      fetch(document.querySelector('meta[name="pim-relay-origin"]').content +
        '/sessions/00000000-0000-0000-0000-000000000000/archive', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: 'desktop-cors-probe', archived: false })
        }).then(response => response.status)
    `);
    assert.equal(
      mutation,
      404,
      'CORS preflight and POST reach relay validation without starting Pi',
    );
    await contents.executeJavaScript(`
      const frame = document.createElement('iframe');
      frame.id = 'visual-probe';
      frame.sandbox = 'allow-scripts';
      frame.src = '/display';
      document.body.append(frame);
    `);
    await until(() => contents.mainFrame.frames.some((frame) => frame.url.endsWith('/display')));
    await until(async () => {
      const frame = contents.mainFrame.frames.find((frame) => frame.url.endsWith('/display'));
      return frame && (await frame.executeJavaScript('Boolean(document.querySelector("iframe"))'));
    });
    await contents.executeJavaScript(`
      document.getElementById('visual-probe').contentWindow.postMessage({
        type: 'pim-display', id: 'smoke', html: '<p>Visual probe</p>'
      }, '*');
    `);
    await until(async () => {
      const outer = contents.mainFrame.frames.find((frame) => frame.url.endsWith('/display'));
      const inner = outer?.frames.find((frame) => frame.url === 'about:srcdoc');
      return (
        inner &&
        (await inner.executeJavaScript(
          'document.body.textContent.includes("Visual probe") && typeof require === "undefined"',
        ))
      );
    });

    await contents.executeJavaScript("window.open('https://outside.invalid/')");
    await delay(100);
    assert.equal(BrowserWindow.getAllWindows().length, 1, 'popup denied');

    console.log('smoke: visuals and popup checked');
    const blocked = once(contents, 'will-frame-navigate');
    await contents.executeJavaScript("location.href = 'https://outside.invalid/'");
    const [navigation] = await blocked;
    assert.equal(navigation.defaultPrevented, true);
    assert.equal(contents.getURL(), `${DESKTOP_ORIGIN}/`);

    console.log('smoke: navigation checked');
    // Keep production asset handling, with one fixture-only HTTP redirect response.
    contents.session.protocol.unhandle(DESKTOP_SCHEME);
    contents.session.protocol.handle(DESKTOP_SCHEME, (request) =>
      new URL(request.url).pathname === '/app/redirect'
        ? new Response(null, { status: 302, headers: { Location: 'https://outside.invalid/' } })
        : bundledResponse(
            request,
            fileURLToPath(new URL('../../dist/desktop/renderer', import.meta.url)),
            process.env.PIM_DESKTOP_SERVER,
          ),
    );
    const redirected = once(contents, 'will-redirect');
    await contents.executeJavaScript("location.href = '/app/redirect'");
    const [redirect] = await redirected;
    assert.equal(redirect.defaultPrevented, true);
    assert.notEqual(contents.getURL(), 'https://outside.invalid/');

    console.log('DESKTOP_SMOKE_OK');
    clearTimeout(deadline);
    window.close();
    // Match macOS close behavior explicitly, where closing the last window keeps the app alive.
    if (process.platform === 'darwin') {
      app.quit();
    }
  })().catch((error) => {
    console.error(error);
    app.exit(1);
  });
});
