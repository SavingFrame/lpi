import { getLineInfo, parse as parseJavaScript } from 'acorn';
import { type DefaultTreeAdapterMap, parse as parseHtml } from 'parse5';

const javaScriptTypes = new Set([
  '',
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
]);

/** Syntax only: never execute authored code or fetch external scripts. */
export function validateDisplayScripts(html: string): void {
  const pending: DefaultTreeAdapterMap['node'][] = [
    parseHtml(html, { sourceCodeLocationInfo: true, scriptingEnabled: false }),
  ];
  let scriptNumber = 0;
  while (pending.length) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if ('tagName' in node && node.tagName === 'script') {
      const type =
        node.attrs
          .find((attribute) => attribute.name === 'type')
          ?.value.trim()
          .toLowerCase() ?? '';
      if (node.attrs.some((attribute) => attribute.name === 'src')) {
        continue;
      }
      if (type !== 'module' && !javaScriptTypes.has(type)) {
        continue;
      }
      const start = node.sourceCodeLocation?.startTag?.endOffset;
      if (start === undefined) {
        continue;
      }
      const end = node.sourceCodeLocation?.endTag?.startOffset ?? html.length;
      scriptNumber++;
      try {
        parseJavaScript(html.slice(start, end), {
          ecmaVersion: 'latest',
          sourceType: type === 'module' ? 'module' : 'script',
        });
      } catch (error) {
        if (!(error instanceof SyntaxError) || !('pos' in error) || typeof error.pos !== 'number') {
          throw error;
        }
        const location = getLineInfo(html, start + error.pos);
        const reason = error.message.replace(/ \(\d+:\d+\)$/, '');
        throw new Error(
          `Inline script #${scriptNumber} has invalid JavaScript at HTML line ${location.line}, column ${location.column + 1}: ${reason}. Fix the script and call show again.`,
        );
      }
    }
    // Template contents are inert and live in a separate fragment, not childNodes.
    if ('childNodes' in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index--) {
        const child = node.childNodes[index];
        if (child) {
          pending.push(child);
        }
      }
    }
  }
}
