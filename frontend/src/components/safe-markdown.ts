import { createElement, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components = {
  img: () => createElement('span', null, '[image]'),
  table: ({ children }: { children?: ReactNode }) =>
    createElement('div', { className: 'markdown-table' }, createElement('table', null, children)),
};

/** Fixed Markdown policy for transcripts and extension previews. Keep the default URL sanitizer. */
export function SafeMarkdown({ children }: { children: string }) {
  return createElement(Markdown, {
    skipHtml: true,
    remarkPlugins: [remarkGfm],
    components,
    children,
  });
}
