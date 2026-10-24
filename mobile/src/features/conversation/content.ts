import { Lexer, type MarkedToken, type Token } from 'marked';
import { imageAttachments } from '../../../../src/shared/attachments.ts';
import type { Message } from '../../../../src/shared/client-state';

// This private lexer has no extensions, so it only produces built-in Marked tokens.
export function markdownTokens(text: string): MarkedToken[] {
  return new Lexer({ gfm: true }).lex(text) as MarkedToken[];
}

export function builtInTokens(tokens: Token[]): MarkedToken[] {
  return tokens as MarkedToken[];
}

export function linkUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export type ContentBlock = {
  kind: 'text' | 'thinking' | 'detail' | 'image';
  uri?: string;
  label: string;
  text: string;
};

const blockCache = new WeakMap<Message, ContentBlock[]>();

/** Messages are immutable snapshots. Do not decode historical images on every token. */
export function messageBlocks(message: Message): ContentBlock[] {
  const cached = blockCache.get(message);
  if (cached) {
    return cached;
  }
  const blocks = projectMessageBlocks(message);
  blockCache.set(message, blocks);
  return blocks;
}

function projectMessageBlocks(message: Message): ContentBlock[] {
  if (typeof message.content === 'string') {
    return [{ kind: 'text', label: '', text: message.content }];
  }
  const hideImageNotes =
    message.role === 'user' && message.content?.some((part) => part.type === 'image');
  return (message.content ?? [])
    .map((part): ContentBlock => {
      switch (part.type) {
        case 'text': {
          const text = String(part.text ?? '');
          return {
            kind: 'text',
            label: '',
            // Pi appends these coordinate hints to image prompts. Hide only that suffix.
            text: hideImageNotes
              ? text.replace(
                  /(?:\s*\[Image: original \d+x\d+, displayed at \d+x\d+\. Multiply coordinates by \d+(?:\.\d+)? to map to original image\.\])+\s*$/,
                  '',
                )
              : text,
          };
        }
        case 'thinking':
          return { kind: 'thinking', label: 'Thinking', text: String(part.thinking ?? '') };
        case 'toolCall':
          return {
            kind: 'detail',
            label: String(part.name ?? 'Tool'),
            text: JSON.stringify(part.arguments ?? {}, null, 2),
          };
        case 'image': {
          try {
            const [image] = imageAttachments([part]);
            if (!image) {
              throw new Error('Missing image');
            }
            return {
              kind: 'image',
              label: 'Image attachment',
              text: '',
              uri: `data:${image.mimeType};base64,${image.data}`,
            };
          } catch {
            return {
              kind: 'detail',
              label: 'Image attachment',
              text: 'Image preview unavailable.',
            };
          }
        }
        default:
          return {
            kind: 'detail',
            label: 'Structured content',
            text: JSON.stringify(part, null, 2),
          };
      }
    })
    .filter((block) => !hideImageNotes || block.kind !== 'text' || block.text.trim());
}
