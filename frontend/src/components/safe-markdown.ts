import { createElement, memo, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

const components = {
  img: () => createElement('span', null, '[image]'),
  table: ({ children }: { children?: ReactNode }) =>
    createElement('div', { className: 'markdown-table' }, createElement('table', null, children)),
};

/** Fixed Markdown policy for transcripts and extension previews. Keep the default URL sanitizer. */
export const SafeMarkdown = memo(function SafeMarkdown({
  children,
  preserveLineBreaks = false,
}: {
  children: string;
  preserveLineBreaks?: boolean;
}) {
  return createElement(Markdown, {
    skipHtml: true,
    remarkPlugins: preserveLineBreaks ? [remarkGfm, remarkBreaks] : [remarkGfm],
    components,
    children,
  });
});
