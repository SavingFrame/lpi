import {
  DEFAULT_DISPLAY_THEME,
  DISPLAY_CSP,
  type DisplayTheme,
  MAX_DISPLAY_HEIGHT,
  MAX_HTML_BYTES,
} from './display.ts';

// These programs execute only inside isolated documents. Keeping them as source strings
// keeps the shared module independent of host DOM and native runtime APIs.
const contentRuntime = `(config => {
  const style = document.currentScript.previousElementSibling;
  const themeListeners = new Set();
  window.lpi = Object.freeze({
    color: name => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    onThemeChange: listener => {
      if (typeof listener !== 'function') throw new TypeError('Expected a theme-change callback.');
      themeListeners.add(listener);
      return () => themeListeners.delete(listener);
    }
  });
  const theme = value => {
    const names = {
      background: '--background', foreground: '--foreground', muted: '--muted-foreground',
      card: '--card', border: '--border', accent: '--accent',
      fontFamily: '--font-sans', fontSize: '--font-size', monoFontFamily: '--font-mono'
    };
    let css = ':root{color-scheme:' + (value.appearance === 'light' ? 'light' : 'dark') + ';';
    for (const [key, name] of Object.entries(names)) {
      if (typeof value[key] === 'string') css += name + ':' + value[key].replace(/[;{}<>]/g, '') + ';';
    }
    const palette = value.appearance === 'light' ? ['#0d9488','#b45309','#9333ea','#be123c','#0369a1'] : ['#2dd4bf','#fbbf24','#c084fc','#fb7185','#38bdf8'];
    css += '--chart-1:var(--accent);' + palette.map((color,index) => '--chart-' + (index+2) + ':' + color + ';').join('') + '--radius:0.625rem}';
    const stylesheet = css +
      'html{background:var(--background);color:var(--foreground);font-family:var(--font-sans);font-size:var(--font-size);line-height:1.6;overflow-x:hidden;scrollbar-width:none;-webkit-text-size-adjust:100%}' +
      'html,body{height:auto!important;min-height:0!important}html::-webkit-scrollbar{display:none}' +
      'body{margin:0;display:flow-root}*{box-sizing:border-box}img,svg,canvas{max-width:100%}' +
      'button,input,select,textarea{font:inherit}code,pre,kbd{font-family:var(--font-mono)}' +
      ':focus-visible{outline:2px solid var(--accent);outline-offset:-2px}';
    if (style.textContent === stylesheet) return;
    style.textContent = stylesheet;
    for (const listener of themeListeners) {
      try { listener(); }
      catch (error) { console.error('Visual theme update failed:', error); }
    }
  };
  theme(config.theme);
  addEventListener('message', event => {
    if (event.source === parent && event.data?.type === 'lpi-display-theme' && event.data.id === config.id && event.data.theme) theme(event.data.theme);
  });
  let height = 0;
  let pending = false;
  const measure = () => {
    pending = false;
    if (!document.body) return;
    const body = document.body;
    const rect = body.getBoundingClientRect();
    const next = Math.ceil(Math.max(rect.bottom + scrollY, rect.top + scrollY + body.scrollHeight));
    if (next > 0 && next !== height) {
      height = next;
      parent.postMessage({type:'lpi-display-size', id:config.id, height:next}, '*');
    }
  };
  const schedule = () => {
    if (!pending) { pending = true; requestAnimationFrame(measure); }
  };
  const resize = new ResizeObserver(schedule);
  resize.observe(document.documentElement);
  addEventListener('DOMContentLoaded', () => {
    resize.observe(document.body);
    new MutationObserver(schedule).observe(document.body, {subtree:true, childList:true, attributes:true, characterData:true});
    schedule();
  });
  addEventListener('load', schedule);
  document.fonts?.ready.then(schedule);
})`;

/**
 * The outer shell never executes authored markup. It parses an inert document and
 * serializes it into an opaque-origin child with the original restrictive CSP.
 * Only theme/content go inward and bounded size notifications come outward.
 */
export function displayDocument(initial?: {
  html: string;
  id: string;
  theme: DisplayTheme;
}): string {
  const bootstrap = String.raw`(() => {
    const frame = document.querySelector('iframe');
    const initial = ${JSON.stringify(initial ?? null).replaceAll('<', `${String.fromCharCode(92)}u003c`)};
    const defaults = ${JSON.stringify(DEFAULT_DISPLAY_THEME)};
    const runtime = ${JSON.stringify(contentRuntime)};
    let current;
    const sendTheme = theme => {
      if (!current) return;
      current.theme = theme;
      document.body.style.background = theme.background;
      frame.contentWindow.postMessage({type:'lpi-display-theme', id:current.id, theme}, '*');
    };
    const show = data => {
      if (typeof data.html !== 'string' || data.html.length > ${MAX_HTML_BYTES} || typeof data.id !== 'string' || data.id.length > 128) return;
      const theme = data.theme || defaults;
      if (current?.id === data.id && current.html === data.html) { sendTheme(theme); return; }
      current = {id:data.id, html:data.html, theme};
      document.body.style.background = theme.background;
      const page = new DOMParser().parseFromString(data.html, 'text/html');
      const style = page.createElement('style');
      const script = page.createElement('script');
      script.textContent = runtime + '(' + JSON.stringify({id:data.id, theme}).replace(/</g, '\\u003c') + ');';
      const viewport = page.createElement('meta');
      viewport.name = 'viewport'; viewport.content = 'width=device-width,initial-scale=1';
      page.head.prepend(style, script, viewport);
      frame.srcdoc = '<!doctype html>' + page.documentElement.outerHTML;
    };
    addEventListener('message', event => {
      const data = event.data;
      if (event.source === parent && data?.type === 'lpi-display') show(data);
      if (event.source === parent && data?.type === 'lpi-display-theme' && current?.id === data.id && data.theme) sendTheme(data.theme);
      if (event.source !== frame.contentWindow || data?.type !== 'lpi-display-size' || data.id !== current?.id || typeof data.height !== 'number' || !Number.isFinite(data.height) || data.height <= 0) return;
      const report = {type:'lpi-display-size', id:current.id, height:Math.min(${MAX_DISPLAY_HEIGHT}, Math.ceil(data.height))};
      // Native's only callback is the same bounded size report, never arbitrary page messages.
      if (initial) window.ReactNativeWebView?.postMessage(JSON.stringify(report));
      else parent.postMessage(report, '*');
    });
    frame.addEventListener('load', () => { if (current) sendTheme(current.theme); });
    if (initial) show(initial);
  })();`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${DISPLAY_CSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,iframe{width:100%;height:100%;margin:0;border:0}body{overflow:hidden;background:transparent}iframe{display:block}</style></head><body><iframe title="Visual content" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe><script>${bootstrap}</script></body></html>`;
}
