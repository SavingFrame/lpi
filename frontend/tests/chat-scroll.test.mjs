import assert from 'node:assert/strict';
import test from 'node:test';
import { chatScroll } from '../src/session/scroll/chat-scroll.ts';

function setup(t, restored) {
  let resize;
  let disconnected = false;
  const observed = [];
  // biome-ignore lint/complexity/useArrowFunction: ResizeObserver is called with new.
  t.mock.method(globalThis, 'ResizeObserver', function (callback) {
    resize = callback;
    return {
      observe(element) {
        observed.push(element);
      },
      disconnect() {
        disconnected = true;
      },
    };
  });
  const viewport = new EventTarget();
  viewport.scrollHeight = 2000;
  viewport.clientHeight = 500;
  let top = 0;
  Object.defineProperty(viewport, 'scrollTop', {
    get: () => top,
    set: (value) => {
      top = Math.max(0, Math.min(value, viewport.scrollHeight - viewport.clientHeight));
    },
  });
  const content = {};
  let following;
  const controller = chatScroll(
    viewport,
    content,
    (value) => {
      following = value;
    },
    restored,
  );
  return {
    viewport,
    content,
    observed,
    controller,
    resize: () => resize(),
    following: () => following,
    disconnected: () => disconnected,
    click: (summary = true) => {
      const target = new Element();
      target.closest = (selector) => (summary && selector === 'summary' ? target : null);
      const event = new Event('click');
      Object.defineProperty(event, 'target', { value: target });
      viewport.dispatchEvent(event);
    },
    scroll: (value) => {
      viewport.scrollTop = value;
      viewport.dispatchEvent(new Event('scroll'));
    },
  };
}

// Node has no native DOM. Keep the stand-ins local to this test process.
globalThis.ResizeObserver = class {};
globalThis.Element = class {};

test('restores a paused tab position without following new content', (t) => {
  const state = setup(t, { top: 700, following: false });
  assert.equal(state.viewport.scrollTop, 700);
  assert.equal(state.following(), false);
  state.viewport.scrollHeight += 500;
  state.resize();
  assert.equal(state.viewport.scrollTop, 700);
  state.scroll(900);
  assert.deepEqual(state.controller.position(), { top: 900, following: false });
  state.controller.follow();
  assert.deepEqual(state.controller.position(), { top: 2000, following: true });
});

test('starts at the bottom and follows content and viewport resizing', (t) => {
  const state = setup(t);
  const { viewport } = state;
  assert.deepEqual(state.observed, [state.content, viewport]);
  assert.equal(viewport.scrollTop, 1500);
  viewport.scrollHeight += 300;
  viewport.dispatchEvent(new Event('scroll'));
  state.resize();
  assert.equal(viewport.scrollTop, 1800);
  assert.equal(state.following(), true);
  viewport.clientHeight = 400;
  state.resize();
  assert.equal(viewport.scrollTop, 1900);
});

test('layout-driven scroll movement does not interrupt following after sending', (t) => {
  const state = setup(t);
  state.scroll(700);
  state.controller.follow();

  // New messages can move the browser's scroll anchor before ResizeObserver runs.
  state.viewport.scrollHeight += 400;
  state.scroll(1700);
  assert.equal(state.following(), true);
  state.resize();
  assert.equal(state.viewport.scrollTop, 1900);

  // A smaller viewport can also produce a scroll event before the resize callback.
  state.viewport.clientHeight = 300;
  state.scroll(1950);
  assert.equal(state.following(), true);
  state.resize();
  assert.equal(state.viewport.scrollTop, 2100);

  state.scroll(1000);
  assert.equal(state.following(), false);
  state.viewport.scrollHeight += 300;
  state.resize();
  assert.equal(state.viewport.scrollTop, 1000);
});

test('manual scrolling pauses following until the reader returns near the bottom', (t) => {
  const state = setup(t);
  state.scroll(700);
  assert.equal(state.following(), false);
  state.viewport.scrollHeight += 300;
  state.resize();
  assert.equal(state.viewport.scrollTop, 700);
  state.scroll(1750);
  assert.equal(state.following(), true);
  state.viewport.scrollHeight += 100;
  state.resize();
  assert.equal(state.viewport.scrollTop, 1900);
});

test('disclosures expand downward without following layout changes', (t) => {
  const state = setup(t);
  state.click(false);
  assert.equal(state.following(), true);

  state.click();
  assert.equal(state.following(), false);
  state.viewport.scrollHeight += 800;
  state.resize();
  assert.equal(state.viewport.scrollTop, 1500);

  // Nested disclosures and collapse also leave the viewport in place.
  state.click();
  state.viewport.scrollHeight -= 300;
  state.resize();
  assert.equal(state.viewport.scrollTop, 1500);
  assert.equal(state.following(), false);

  // Returning to the bottom restores normal streaming follow.
  state.scroll(2000);
  assert.equal(state.following(), true);
  state.viewport.scrollHeight += 100;
  state.resize();
  assert.equal(state.viewport.scrollTop, 2100);
});

test('search navigation can pause following before the next layout resize', (t) => {
  const state = setup(t);
  state.controller.pause();
  assert.equal(state.following(), false);
  state.viewport.scrollHeight += 300;
  state.resize();
  assert.equal(state.viewport.scrollTop, 1500);
  state.controller.follow();
  assert.equal(state.following(), true);
  assert.equal(state.viewport.scrollTop, 1800);
});

test('explicit follow resumes immediately and cleanup removes listeners and observer', (t) => {
  const state = setup(t);
  state.scroll(700);
  state.controller.follow();
  assert.equal(state.following(), true);
  assert.equal(state.viewport.scrollTop, 1500);
  state.viewport.scrollHeight += 100;
  state.resize();
  assert.equal(state.viewport.scrollTop, 1600);
  state.controller.disconnect();
  assert.equal(state.disconnected(), true);
  state.scroll(700);
  state.click();
  assert.equal(state.following(), true);
});
