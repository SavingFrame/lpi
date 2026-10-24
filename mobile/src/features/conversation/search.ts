import type { MarkedToken } from 'marked';
import { type TextMatch, textMatches } from '../../../../src/client/text-search.ts';
import { builtInTokens, markdownTokens } from './content.ts';
import type { ConversationRow } from './timeline.ts';

export function inlineTokenText(token: MarkedToken): string {
  if (token.type === 'br') {
    return '\n';
  }
  if (token.type === 'image') {
    return `[Image: ${token.text || 'attachment'}]`;
  }
  return 'text' in token ? token.text : token.raw;
}

/** Mirrors the native Markdown renderer. URLs, syntax and code-language labels are not text. */
export function markdownProjection(tokens: MarkedToken[]) {
  let text = '';
  const offsets = new Map<MarkedToken, number>();
  const append = (token: MarkedToken, value: string) => {
    offsets.set(token, text.length);
    text += value;
  };
  const inline = (items: MarkedToken[]) => {
    for (const token of items) {
      if (token.type !== 'image' && 'tokens' in token && token.tokens) {
        inline(builtInTokens(token.tokens));
      } else {
        append(token, inlineTokenText(token));
      }
    }
  };
  const blocks = (items: MarkedToken[]) => {
    for (const token of items) {
      switch (token.type) {
        case 'space':
        case 'def':
        case 'hr':
          continue;
        case 'blockquote':
          blocks(builtInTokens(token.tokens));
          continue;
        case 'list':
          for (const item of token.items) {
            blocks(builtInTokens(item.tokens));
          }
          continue;
        case 'table':
          for (const row of [token.header, ...token.rows]) {
            for (const cell of row) {
              inline(builtInTokens(cell.tokens));
              text += '\n';
            }
          }
          continue;
        case 'paragraph':
        case 'heading':
        case 'text':
          if (token.tokens) {
            inline(builtInTokens(token.tokens));
          } else {
            append(token, token.text);
          }
          break;
        case 'code':
          append(token, token.text);
          break;
        default:
          append(token, token.raw);
      }
      text += '\n';
    }
  };
  blocks(tokens);
  return { text, offsets };
}

export interface ConversationMatch extends TextMatch {
  rowKey: string;
  block: number;
}

/** Oldest first, independent of the inverted native list's presentation order. */
export function searchConversation(rows: ConversationRow[], query: string): ConversationMatch[] {
  if (!query) {
    return [];
  }
  const matches: ConversationMatch[] = [];
  for (const row of [...rows].reverse()) {
    if (row.kind !== 'message' || (row.role !== 'user' && row.role !== 'assistant')) {
      continue;
    }
    for (const [block, content] of row.blocks.entries()) {
      if (content.kind !== 'text') {
        continue;
      }
      const text =
        row.role === 'user' ? content.text : markdownProjection(markdownTokens(content.text)).text;
      for (const match of textMatches(text, query)) {
        matches.push({ ...match, rowKey: row.key, block });
      }
    }
  }
  return matches;
}
