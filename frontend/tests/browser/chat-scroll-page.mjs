import { chatScroll } from './chat-scroll.js';

const passed = [];
const pause = () => new Promise((resolve) => setTimeout(resolve, 80));
const check = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

try {
  document.body.innerHTML = `
    <main id="viewport" style="height:240px;width:400px;overflow:auto">
      <div id="content">
        <div style="height:800px">History</div>
        <div id="tail" style="height:200px">Streaming reply</div>
        <details><summary>Tool output</summary><div style="height:600px">Result</div></details>
      </div>
    </main>`;
  const viewport = document.querySelector('#viewport');
  const content = document.querySelector('#content');
  const tail = document.querySelector('#tail');
  const atBottom = () =>
    Math.abs(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop) <= 1;
  let following;
  const controller = chatScroll(viewport, content, (value) => {
    following = value;
  });
  await pause();
  check(atBottom() && following, 'initial history should start at the bottom');
  tail.style.height = '400px';
  await pause();
  check(atBottom() && following, 'content growth should follow actual layout');
  viewport.style.height = '180px';
  await pause();
  check(atBottom() && following, 'viewport resize should retain following');
  passed.push('streaming and resize');

  viewport.scrollTop = 100;
  await pause();
  check(!following, 'reader scrolling away should stop following');
  tail.style.height = '600px';
  await pause();
  check(Math.abs(viewport.scrollTop - 100) <= 1, 'streaming must preserve the reader position');
  controller.follow();
  await pause();
  check(atBottom() && following, 'explicit follow should return to the bottom');
  passed.push('manual scroll');

  const before = viewport.scrollTop;
  content.querySelector('summary').click();
  await pause();
  check(content.querySelector('details').open, 'native details should open');
  check(!following, 'opening output should pause following');
  check(Math.abs(viewport.scrollTop - before) <= 1, 'opening output must not drag the reader down');
  content.querySelector('summary').click();
  await pause();
  check(!following, 'closing output must not resume following');
  controller.follow();
  await pause();
  check(atBottom() && following, 'explicit follow should work after disclosure changes');
  passed.push('disclosures');

  controller.disconnect();
  viewport.scrollTop = 100;
  await pause();
  tail.style.height = '800px';
  await pause();
  check(
    Math.abs(viewport.scrollTop - 100) <= 1,
    'disconnected observers must not move the viewport',
  );
  check(following, 'disconnected scroll listeners must not update following state');
  passed.push('cleanup');

  content.className = 'transcript';
  content.innerHTML = Array.from(
    { length: 12 },
    (_, index) => `<article class="message assistant">
      <header>Pi</header>
      <div style="height:${700 + index * 100}px">Turn ${index}</div>
    </article>`,
  ).join('');
  viewport.style.height = '300px';
  viewport.scrollTop = 0;
  await pause();
  const coldHeight = viewport.scrollHeight;
  viewport.scrollTop = viewport.scrollHeight;
  await pause();
  viewport.scrollTop = 0;
  await pause();
  check(
    Math.abs(viewport.scrollHeight - coldHeight) <= 1,
    'visiting offscreen turns must not replace estimated message heights',
  );
  passed.push('stable message heights');

  const reader = chatScroll(viewport, content, (value) => {
    following = value;
  });
  const anchor = content.children[6].querySelector('header');
  viewport.scrollTop +=
    anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 40;
  await pause();
  check(!following, 'reading older turns should pause bottom following');
  const anchorTop = anchor.getBoundingClientRect().top;
  const preview = content.children[4].querySelector('div');
  preview.style.height = `${preview.offsetHeight + 1200}px`;
  await pause();
  check(
    Math.abs(anchor.getBoundingClientRect().top - anchorTop) <= 1,
    `a deferred preview expanding above the reader must preserve the visible message (${anchorTop} -> ${anchor.getBoundingClientRect().top}, anchoring: ${getComputedStyle(viewport).overflowAnchor})`,
  );
  check(!following, 'scroll anchoring must not reenable bottom following');
  reader.follow();
  await pause();
  check(atBottom() && following, 'explicit follow still works after scroll anchoring');
  reader.disconnect();
  passed.push('deferred preview anchoring');
  await fetch('/result', { method: 'POST', body: JSON.stringify({ passed }) });
} catch (error) {
  await fetch('/result', {
    method: 'POST',
    body: JSON.stringify({ passed, error: String(error.stack ?? error) }),
  });
}
