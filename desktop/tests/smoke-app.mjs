import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { app, BrowserWindow, Menu } from 'electron';
import { DESKTOP_ORIGIN, DESKTOP_SCHEME } from '../../dist/src/shared/desktop.js';
import '../../dist/desktop/main/index.js';

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
      assert.equal(contents.getZoomFactor(), 1.15, 'saved scale restored after app restart');
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
    await contents.executeJavaScript('document.querySelector(\'a[href="/app/settings"]\').click()');
    await until(() =>
      contents.executeJavaScript("document.querySelector('#desktop-scale')?.value === '100'"),
    );
    const baseWidth = await contents.executeJavaScript('window.innerWidth');
    await contents.executeJavaScript(`
      const select = document.querySelector('#desktop-scale');
      select.value = '125';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await until(() => Math.abs(contents.getZoomFactor() - 1.25) < 0.0001);
    await until(
      async () => (await contents.executeJavaScript('window.innerWidth')) < baseWidth * 0.9,
    );
    contents.sendInputEvent({ type: 'keyDown', keyCode: '=', modifiers: ['control'] });
    contents.sendInputEvent({ type: 'keyUp', keyCode: '=', modifiers: ['control'] });
    await until(() => Math.abs(contents.getZoomFactor() - 1.3) < 0.0001);
    await until(() =>
      contents.executeJavaScript("document.querySelector('#desktop-scale')?.value === '130'"),
    );
    const viewMenu = Menu.getApplicationMenu().items.find((item) => item.label === 'View');
    viewMenu.submenu.items.find((item) => item.label === 'Zoom Out').click();
    await until(() => Math.abs(contents.getZoomFactor() - 1.25) < 0.0001);
    contents.sendInputEvent({ type: 'keyDown', keyCode: '0', modifiers: ['control'] });
    contents.sendInputEvent({ type: 'keyUp', keyCode: '0', modifiers: ['control'] });
    await until(() => Math.abs(contents.getZoomFactor() - 1) < 0.0001);
    await contents.executeJavaScript('window.pimDesktop.setZoom(1.15)');
    assert.equal(contents.getZoomFactor(), 1.15);
    await assert.rejects(contents.executeJavaScript('window.pimDesktop.setZoom(999)'));
    assert.equal(contents.getZoomFactor(), 1.15, 'invalid IPC does not change scale');
    const reloaded = once(contents, 'did-finish-load');
    contents.reload();
    await reloaded;
    await until(() =>
      contents.executeJavaScript("document.querySelector('#desktop-scale')?.value === '115'"),
    );
    assert.equal(contents.getZoomFactor(), 1.15, 'scale survives reload');
    await contents.executeJavaScript("document.querySelector('.brand a').click()");
    await until(() => contents.getURL() === `${DESKTOP_ORIGIN}/`);
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
          'document.body.textContent.includes("Visual probe") && typeof require === "undefined" && typeof window.pimDesktop === "undefined"',
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
    // Production handling was exercised above. Only this final navigation uses a redirect fixture.
    contents.session.protocol.unhandle(DESKTOP_SCHEME);
    contents.session.protocol.handle(
      DESKTOP_SCHEME,
      () => new Response(null, { status: 302, headers: { Location: 'https://outside.invalid/' } }),
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
