import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { emptyView } from '../../../src/shared/client-state.ts';
import { Transcript } from '../../src/transcript';
import '../../src/style.css';

const check = (value, message) => {
  if (!value) {
    throw new Error(message);
  }
};
const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${document.body.innerHTML.slice(-3000)}`);
};
const reports = [];
window.addEventListener('message', (event) => {
  if (event.data?.displayProbe) {
    reports.push({ ...event.data, origin: event.origin });
  }
});
try {
  const host = document.createElement('main');
  host.style.maxWidth = '360px';
  document.body.append(host);
  const root = createRoot(host);
  const render = (messages) =>
    flushSync(() => root.render(createElement(Transcript, { view: { ...emptyView(), messages } })));
  const click = (label) => {
    const button = [...host.querySelectorAll('button')].find(
      (node) => node.textContent === label || node.getAttribute('aria-label') === label,
    );
    check(button, `Missing ${label} button`);
    const options = button.closest('.display-options');
    if (options && !options.open) {
      options.querySelector('summary').click();
    }
    flushSync(() => button.click());
  };
  const base = location.origin;
  const cdn = document.querySelector('meta[name="fixture-cdn"]').content;
  check(new URL(cdn).origin !== base, 'library fixture is genuinely cross-origin');
  const html = `<!doctype html><meta name="viewport" content="width=device-width"><style>body{font-family:sans-serif}button{padding:12px}</style>
    <link rel="stylesheet" href="${cdn}/chart.css" crossorigin="anonymous">
    <script src="${cdn}/chart.js" crossorigin="anonymous"></script>
    <canvas id="chart" class="cdn-probe" width="20" height="20"></canvas>
    <img src="${base}/leak?image"><iframe src="${base}/leak?frame"></iframe>
    <form action="${base}/leak?form" method="POST"><input name="secret" value="value"></form>
    <button id="counter">0</button><script>
      const facts={displayProbe:true};
      const canvas=document.querySelector('#chart');
      facts.libraryLoaded=typeof window.fixtureChart==='function';
      facts.chartPixel=facts.libraryLoaded?window.fixtureChart(canvas):[];
      facts.libraryStyle=getComputedStyle(canvas).color;
      const button=document.querySelector('button');
      button.onclick=()=>button.textContent=String(Number(button.textContent)+1);
      button.click();facts.counter=button.textContent;
      try{parent.document.body.dataset.escaped='yes';facts.parentAccess=true;}catch{facts.parentAccess=false;}
      try{top.document.body.dataset.escaped='yes';facts.topAccess=true;}catch{facts.topAccess=false;}
      try{localStorage.setItem('secret','value');facts.storage=true;}catch{facts.storage=false;}
      try{document.cookie='secret=value';facts.cookies=true;}catch{facts.cookies=false;}
      try{window.open('${base}/leak?popup');}catch{}
      try{top.location='${base}/leak?top';}catch{}
      try{document.querySelector('form').submit();}catch{}
      fetch('${base}/leak?api',{method:'POST',body:'secret'}).then(()=>facts.fetch=true,()=>facts.fetch=false).finally(()=>{
        top.postMessage(facts,'*');
        location.replace('${base}/leak?navigation');
      });
    </script>`;
  const artifact = {
    version: 1,
    kind: 'html',
    title: 'Interactive chart',
    filename: 'chart.html',
    summary: 'A chart with local controls.',
    html,
  };
  const result = {
    role: 'toolResult',
    toolName: 'show',
    toolCallId: 'show-1',
    timestamp: 2,
    content: [{ type: 'text', text: 'Displayed chart.' }],
    details: { pimDisplay: artifact },
  };
  const call = {
    role: 'assistant',
    timestamp: 1,
    content: [
      { type: 'toolCall', id: 'read-before', name: 'read', arguments: { path: 'data.csv' } },
      {
        type: 'toolCall',
        id: 'show-1',
        name: 'show',
        arguments: { path: 'chart.html', summary: artifact.summary },
      },
      { type: 'toolCall', id: 'read-after', name: 'read', arguments: { path: 'other.csv' } },
    ],
  };
  render([call, result]);
  await waitFor(() => reports.length);
  const probe = reports[0];
  check(probe.libraryLoaded, 'cross-origin chart library executes inside the sandbox');
  check(
    probe.chartPixel.join(',') === '45,212,191,255',
    'external library draws real canvas pixels',
  );
  check(probe.libraryStyle === 'rgb(12, 34, 56)', 'cross-origin styles apply inside the visual');
  check(probe.counter === '1', 'local inline scripts and controls work under production CSP');
  check(probe.origin === 'null', 'artifact has an opaque origin');
  check(!probe.parentAccess && !probe.topAccess, 'parent and host DOM are inaccessible');
  check(
    !probe.storage && !probe.cookies && !probe.fetch,
    'storage, cookies and API requests are blocked',
  );
  check(!document.body.dataset.escaped, 'artifact did not mutate host DOM');
  check(host.querySelector('.display-card'), 'paired result renders inline');
  check(
    !host.querySelector('.display-card').closest('.tool-group'),
    'displays stay outside collapsed tool groups',
  );
  check(
    host.querySelector('.display-accessibility').textContent === artifact.summary,
    'summary remains available to assistive technology',
  );
  check(
    !host.querySelector('.display-toolbar, .display-summary, .display-notice'),
    'inline visuals have no banner, caption or warning footer',
  );
  check(
    getComputedStyle(host.querySelector('.display-card')).borderTopWidth === '0px',
    'visuals have no outer border',
  );
  const preview = host.querySelector('.display-frame');
  check(preview.getBoundingClientRect().height >= 80, 'preview is visible');
  check(preview.getBoundingClientRect().width <= 360, 'preview fits narrow conversations');
  await waitFor(() => host.querySelector('a[download]')?.getAttribute('href')?.startsWith('blob:'));
  check(host.querySelector('a[download]').download === 'chart.html', 'download retains filename');
  click('Source');
  check(host.querySelector('.display-source').textContent === html, 'source is escaped text');
  check(!host.querySelector('iframe'), 'source view does not execute markup');
  click('Preview');
  click('Expand visual');
  await waitFor(() => host.querySelector('dialog')?.open);
  check(
    host.querySelector('dialog').getBoundingClientRect().width > 360,
    'expanded preview uses viewport space',
  );
  click('Close visual');
  check(!host.querySelector('dialog'), 'expanded frame is disposed');
  render([JSON.parse(JSON.stringify(result))]);
  check(
    host.querySelector('.display-card'),
    'orphan saved history renders without the original call',
  );
  const image = {
    ...artifact,
    kind: 'image',
    image: {
      type: 'image',
      mimeType: 'image/png',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8uoAAAAASUVORK5CYII=',
    },
  };
  render([{ ...result, details: { pimDisplay: image } }]);
  await waitFor(() => host.querySelector('.display-image')?.naturalWidth === 1);
  check(!host.querySelector('iframe'), 'image uses a normal image viewer');
  // Layout and theme reports are generated inside the opaque content frame. The
  // fixture can message that window, but never read its document or the wrapper's.
  const layoutHtml = `<!doctype html><style>
    main{display:grid;gap:16px}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
    .stat{height:80px;border-bottom:1px solid var(--border)}strong{font-size:24px}
    .plot{height:220px}button{background:var(--card);color:var(--foreground);border:1px solid var(--border);padding:8px}
    @media(max-width:480px){.stats{grid-template-columns:1fr}}
    </style><main><div class="stats"><div class="stat"><strong>85.0k</strong><br>Active installs</div><div class="stat"><strong>24.0M</strong><br>Turns sent</div><div class="stat"><strong>27</strong><br>Median turns</div></div>
    <h3>Turn duration by provider</h3><svg class="plot" viewBox="0 0 600 220" width="100%" aria-label="Turn duration chart"><g fill="var(--muted-foreground)" font-size="14"><text x="0" y="40">Claude Code</text><text x="0" y="90">Codex</text><text x="0" y="140">Pi</text></g><g stroke-linecap="round" stroke-width="10"><path d="M130 35H340" stroke="var(--chart-1)"/><path d="M130 85H520" stroke="var(--chart-2)"/><path d="M130 135H430" stroke="var(--chart-3)"/></g></svg>
    <button id="toggle">Show detail</button><section id="detail" hidden style="height:600px">More information</section><input id="filter" value="initial"></main>
    <script>
      const detail=document.querySelector('#detail');const filter=document.querySelector('#filter');
      let selection='initial';const report=()=>top.postMessage({displayProbe:true,kind:'layout',height:Math.ceil(document.body.getBoundingClientRect().height),width:innerWidth,overflow:document.documentElement.scrollHeight-innerHeight,background:getComputedStyle(document.documentElement).backgroundColor,foreground:getComputedStyle(document.documentElement).color,font:getComputedStyle(document.body).fontFamily,selection},'*');
      document.querySelector('#toggle').onclick=()=>{detail.hidden=!detail.hidden;selection='kept';filter.value=selection;};
      addEventListener('message',event=>{if(event.data?.probeAction==='toggle')document.querySelector('#toggle').click();requestAnimationFrame(report);});
      new ResizeObserver(report).observe(document.body);addEventListener('load',report);
    </script>`;
  render([{ ...result, details: { pimDisplay: { ...artifact, html: layoutHtml } } }]);
  const latest = () => reports.filter((report) => report.kind === 'layout').at(-1);
  await waitFor(() => latest()?.height > 300);
  const frame = host.querySelector('.display-frame');
  const frameHeight = () => Math.round(frame.getBoundingClientRect().height);
  const probeLayout = (probeAction) =>
    frame.contentWindow.frames[0].postMessage({ probeAction }, '*');
  await waitFor(() => Math.abs(frameHeight() - latest().height) <= 1);
  const narrow = frameHeight();
  check(narrow !== 380, 'inline height follows content rather than a fixed viewport');
  await waitFor(() => {
    probeLayout('report');
    return latest().overflow <= 1;
  });
  check(latest().overflow <= 1, 'the iframe has no inner vertical scroll');
  check(latest().background === 'rgb(24, 24, 27)', 'visual background matches Pim');
  check(latest().font.includes('Inter'), 'visual typography matches the reply');
  const sizes = [];
  const recordSize = (event) => {
    if (event.data?.type === 'pim-display-size') {
      sizes.push(event.data);
    }
  };
  window.addEventListener('message', recordSize);
  probeLayout('toggle');
  await waitFor(() => frameHeight() > narrow + 500);
  const grown = frameHeight();
  probeLayout('toggle');
  await waitFor(() => frameHeight() < grown - 500 && Math.abs(frameHeight() - narrow) <= 1);
  check(sizes.length > 0, 'dynamic size reports reach the host');
  const sizeId = sizes.at(-1).id;
  window.postMessage({ type: 'pim-display-size', id: sizeId, height: 19999 }, '*');
  await new Promise((resolve) => setTimeout(resolve, 50));
  check(frameHeight() === narrow, 'matching data from the wrong window cannot resize a visual');
  window.removeEventListener('message', recordSize);
  host.style.maxWidth = '760px';
  await waitFor(() => latest().width > 650 && frameHeight() < narrow - 100);
  await waitFor(() => Math.abs(frameHeight() - latest().height) <= 1);
  document.documentElement.style.setProperty('--background', '#0b1220');
  document.documentElement.style.setProperty('--foreground', '#dbeafe');
  document.documentElement.style.colorScheme = 'light';
  await waitFor(() => {
    probeLayout('report');
    return latest()?.background === 'rgb(11, 18, 32)';
  });
  check(latest().selection === 'kept', 'theme changes preserve local control state');
  check(latest().foreground === 'rgb(219, 234, 254)', 'theme text color updates live');
  check(
    host.querySelector('.display-frame') === frame,
    'theme and width changes do not remount the frame',
  );
  host.style.maxWidth = '360px';
  await waitFor(() => latest().width < 400 && Math.abs(frameHeight() - narrow) <= 1);
  render([{ ...result, details: { pimDisplay: { ...artifact, version: 99 } } }]);
  check(!host.querySelector('.display-card'), 'unsupported artifacts retain the raw tool fallback');
  render([
    {
      role: 'assistant',
      timestamp: 3,
      content: '<iframe src="/display"></iframe>\n\n<script>evil()</script>',
    },
  ]);
  check(
    !host.querySelector('iframe') && !host.querySelector('script'),
    'normal chat HTML stays disabled',
  );
  const inline = document.createElement('script');
  inline.textContent = 'document.body.dataset.inlineScriptRan = "yes";';
  document.body.append(inline);
  await new Promise((resolve) => setTimeout(resolve, 400));
  check(!document.body.dataset.inlineScriptRan, 'chat CSP still blocks inline scripts');
  root.unmount();
  await fetch('/result', { method: 'POST', body: JSON.stringify({ passed: true }) });
} catch (error) {
  await fetch('/result', {
    method: 'POST',
    body: JSON.stringify({ error: String(error.stack ?? error) }),
  });
}
