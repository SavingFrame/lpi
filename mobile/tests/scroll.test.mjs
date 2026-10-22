import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationScroll } from '../src/features/conversation/scroll.ts';

function fixture() {
  const changes = [];
  const commands = [];
  const scroll = conversationScroll({
    scrollToLatest: (animated) => commands.push({ animated }),
    onChange: (following, reading) => changes.push({ following, reading }),
  });
  return { scroll, changes, commands, jumps: () => commands.length, state: () => changes.at(-1) };
}

test('anchors initial history, streaming and viewport changes at the inverted list origin', () => {
  const f = fixture();
  f.scroll.layout(600);
  assert.equal(f.jumps(), 0);
  assert.equal(f.state().reading, false);
  f.scroll.contentSize(4000);
  assert.equal(f.jumps(), 0);
  assert.deepEqual(f.state(), { following: true, reading: true });
  f.scroll.contentSize(4100);
  f.scroll.layout(300);
  f.scroll.layout(600);
  assert.equal(f.jumps(), 0); // Already at zero, so no redundant scroll commands.
  f.scroll.scroll(100); // Native position maintenance is not user scrolling.
  assert.deepEqual(f.state(), { following: true, reading: false });
  assert.equal(f.jumps(), 0);
  f.scroll.contentSize(4200);
  assert.deepEqual(f.commands, [{ animated: false }]);
  f.scroll.scroll(0);
  f.scroll.scroll(50);
  f.scroll.layout(350);
  assert.deepEqual(f.commands, [{ animated: false }, { animated: false }]);
  f.scroll.scroll(0);
  assert.equal(f.state().reading, true);
});

test('dragging and momentum pause following without pulling the reader down on growth or resize', () => {
  const f = fixture();
  f.scroll.layout(600);
  f.scroll.contentSize(4000);
  const before = f.jumps();
  f.scroll.beginInteraction();
  assert.equal(f.state().reading, false);
  f.scroll.scroll(150);
  f.scroll.contentSize(4200);
  f.scroll.endInteraction();
  f.scroll.beginMomentum();
  f.scroll.scroll(500);
  f.scroll.endMomentum();
  f.scroll.layout(300);
  f.scroll.contentSize(4400);
  f.scroll.scroll(700); // Native anchoring must not resume following.
  assert.equal(f.jumps(), before);
  assert.deepEqual(f.state(), { following: false, reading: false });
  f.scroll.beginInteraction();
  f.scroll.scroll(10);
  f.scroll.endInteraction();
  assert.equal(f.state().following, true);
  assert.equal(f.jumps(), before);
});

test('inspecting details pauses even at zero and Latest waits for the native position', () => {
  const f = fixture();
  f.scroll.layout(600);
  f.scroll.contentSize(4000);
  f.scroll.pause();
  const before = f.jumps();
  f.scroll.contentSize(5000);
  f.scroll.layout(350);
  f.scroll.scroll(0);
  assert.equal(f.jumps(), before);
  assert.deepEqual(f.state(), { following: false, reading: false });
  f.scroll.scroll(400);
  f.scroll.latest();
  assert.equal(f.jumps(), before + 1);
  assert.deepEqual(f.commands.at(-1), { animated: true });
  assert.deepEqual(f.state(), { following: true, reading: false });
  f.scroll.beginMomentum();
  f.scroll.scroll(200);
  f.scroll.contentSize(5100);
  f.scroll.layout(400);
  assert.equal(f.state().following, true);
  assert.equal(f.jumps(), before + 1, 'layout and animation frames must not interrupt Latest');
  f.scroll.scroll(0);
  f.scroll.endMomentum();
  assert.equal(f.state().reading, true);
});

test('short histories and iOS bottom bounce remain at the latest content', () => {
  const f = fixture();
  f.scroll.contentSize(100);
  f.scroll.layout(600);
  f.scroll.beginInteraction();
  f.scroll.scroll(-80);
  f.scroll.endInteraction();
  f.scroll.contentSize(110);
  f.scroll.layout(550);
  f.scroll.beginMomentum();
  f.scroll.scroll(-30);
  f.scroll.endMomentum();
  f.scroll.scroll(0);
  assert.deepEqual(f.state(), { following: true, reading: true });
  assert.deepEqual(f.commands, [], 'release and spring-back must not force offset zero');
});

test('a drag can interrupt animated Latest and keep the reader away from the bottom', () => {
  const f = fixture();
  f.scroll.layout(600);
  f.scroll.contentSize(4000);
  f.scroll.scroll(500);
  f.scroll.latest();
  f.scroll.scroll(300);
  f.scroll.beginInteraction();
  f.scroll.scroll(250);
  f.scroll.endInteraction();
  f.scroll.contentSize(4200);
  assert.deepEqual(f.state(), { following: false, reading: false });
  assert.deepEqual(f.commands, [{ animated: true }]);
});
