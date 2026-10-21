import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafeMarkdown } from '../src/components/safe-markdown.ts';

function render(children) {
  return renderToStaticMarkup(createElement(SafeMarkdown, { children }));
}

test('ordinary Markdown renders headings, lists, emphasis, quotes and code', () => {
  const html = render(
    '# Title\n\n**Strong** and *emphasis*.\n\n- Item\n\n> Quote\n\n```js\nconst x = 1;\n```',
  );
  for (const expected of [
    '<h1>Title</h1>',
    '<strong>Strong</strong>',
    '<em>emphasis</em>',
    '<li>Item</li>',
    '<blockquote>',
    '<pre><code class="language-js">const x = 1;',
  ]) {
    assert.ok(html.includes(expected), expected);
  }
});

test('GFM tables render headers, rows, alignment and inline Markdown', () => {
  const html = render(
    '| Item | Status |\n| :--- | ---: |\n| **Coffee** | Ready |\n| Table | Drawn |',
  );
  assert.match(html, /<div class="markdown-table"><table>/);
  assert.match(html, /<thead><tr><th style="text-align:left">Item<\/th>/);
  assert.match(html, /<th style="text-align:right">Status<\/th>/);
  assert.match(html, /<td style="text-align:left"><strong>Coffee<\/strong><\/td>/);
  assert.match(html, /<td style="text-align:right">Ready<\/td>/);
  assert.match(html, /<td style="text-align:left">Table<\/td>/);
  assert.match(html, /<td style="text-align:right">Drawn<\/td>/);
  assert.match(html, /<\/table><\/div>/);
});

test('table cells retain image blocking and URL sanitization', () => {
  const html = render(
    '| Image | Link |\n| --- | --- |\n| ![tracker](https://evil.example/tracker.png) | [click](javascript:evil) |',
  );
  assert.match(html, /<table>/);
  assert.match(html, /<span>\[image\]<\/span>/);
  assert.doesNotMatch(html, /<img|src=|href="javascript:/i);
});

test('raw HTML cannot create scripts, frames or event-bearing elements', () => {
  const html = render(
    'Before\n\n<script>alert(1)</script>\n\n<iframe src="https://evil.example"></iframe>\n\n<img src=x onerror="alert(1)">\n\nAfter',
  );
  assert.match(html, /Before/);
  assert.match(html, /After/);
  assert.doesNotMatch(html, /<script|<iframe|<img|onerror|alert\(1\)/);
});

for (const url of [
  'https://evil.example/tracker.png',
  'data:image/png;base64,AAAA',
  '/private.png',
]) {
  test(`Markdown image URLs stay placeholders: ${url}`, () => {
    const html = render(`![image](${url})`);
    assert.equal(html, '<p><span>[image]</span></p>');
    assert.doesNotMatch(html, /<img|src=|preload/);
  });
}

for (const url of ['javascript:alert%281%29', 'vbscript:evil', 'data:text/html,evil']) {
  test(`default URL sanitization blocks unsafe links: ${url}`, () => {
    const html = render(`[click](${url})`);
    assert.match(html, /click/);
    assert.doesNotMatch(html, /href="(?:javascript|vbscript|data):/i);
  });
}

test('safe web and relative links retain their targets', () => {
  const html = render('[docs](https://example.com/docs) and [local](/sessions)');
  assert.match(html, /href="https:\/\/example.com\/docs"/);
  assert.match(html, /href="\/sessions"/);
});

test('code examples are escaped instead of interpreted as raw HTML', () => {
  const html = render('`<img src=x onerror=evil>`');
  assert.match(html, /<code>&lt;img src=x onerror=evil&gt;<\/code>/);
  assert.doesNotMatch(html, /<img/);
});
