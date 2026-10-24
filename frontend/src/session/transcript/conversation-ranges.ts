import { textMatches } from '../../../../src/client/text-search.ts';

/** Search rendered message text, including matches split by Markdown formatting. */
export function conversationRanges(root: Element, query: string): Range[] {
  if (!query) {
    return [];
  }
  const ranges: Range[] = [];
  for (const body of root.querySelectorAll('[data-chat-search-text]')) {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const nodes: { node: Node; start: number; end: number }[] = [];
    let text = '';
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const value = node.textContent ?? '';
      nodes.push({ node, start: text.length, end: text.length + value.length });
      text += value;
    }
    for (const { start, end } of textMatches(text, query)) {
      const first = nodes.find((part) => part.end > start);
      const last = nodes.find((part) => part.end >= end);
      if (!first || !last) {
        continue;
      }
      const range = document.createRange();
      range.setStart(first.node, start - first.start);
      range.setEnd(last.node, end - last.start);
      ranges.push(range);
    }
  }
  return ranges;
}
