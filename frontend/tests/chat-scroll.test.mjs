import assert from 'node:assert/strict';
import test from 'node:test';
import { chatScroll } from '../src/chat-scroll.ts';

function setup(t) {
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
  const controller = chatScroll(viewport, content, (value) => {
    following = value;
  });
  return {
    viewport,
    content,
    observed,
    controller,
    resize: () => resize(),
    following: () => following,
    disconnected: () => disconnected,
    scroll: (value) => {
      viewport.scrollTop = value;
      viewport.dispatchEvent(new Event('scroll'));
    },
  };
}

// Node has no native ResizeObserver. Keep the stand-in local to this test process.
globalThis.ResizeObserver = class {};

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
  assert.equal(state.following(), true);
});
