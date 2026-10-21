import { createElement } from 'react';
import Markdown from 'react-markdown';

const components = {
  img: () => createElement('span', null, '[image]'),
};

/** Fixed Markdown policy for transcripts and extension previews. Keep the default URL sanitizer. */
export function SafeMarkdown({ children }: { children: string }) {
  return createElement(Markdown, { skipHtml: true, components, children });
}
