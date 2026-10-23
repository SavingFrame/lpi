import type { Message, ToolActivity } from '../../../../src/shared/client-state';
import { type DisplayArtifact, displayArtifact } from '../../../../src/shared/display.ts';
import { type ContentBlock, messageBlocks } from './content.ts';

export interface ToolEntry {
  key: string;
  id?: string;
  args?: unknown;
  result?: Message;
  name: string;
  preview?: string;
  arguments?: string;
  output?: string;
  status: 'running' | 'complete' | 'error' | 'unknown';
}

export type ConversationRow =
  | { kind: 'message'; key: string; role: string; blocks: ContentBlock[] }
  | { kind: 'tools'; key: string; tools: ToolEntry[] }
  | { kind: 'display'; key: string; artifact: DisplayArtifact }
  | { kind: 'question'; key: string; tool: ToolEntry };

/** A bounded, single-line hint only. Keep the original arguments untouched for inspection. */
export function toolPreview(args: unknown): string | undefined {
  if (typeof args === 'string') {
    return args.replace(/\s+/g, ' ').trim().slice(0, 240) || undefined;
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return undefined;
  }
  const fields = args as Record<string, unknown>;
  for (const key of ['command', 'path', 'query', 'url', 'code', 'script']) {
    const value = fields[key];
    if (typeof value === 'string' && value.trim()) {
      return value.replace(/\s+/g, ' ').trim().slice(0, 240);
    }
  }
  return undefined;
}

/** Presentation only. Correlate results by tool ID, never by name or timestamp. */
export function conversationRows(messages: Message[], active: ToolActivity[]): ConversationRow[] {
  const rows: ConversationRow[] = [];
  const calls = new Map<string, ToolEntry>();
  function addTool(tool: ToolEntry) {
    if (tool.name === 'ask_user_question') {
      rows.push({ kind: 'question', key: `question:${tool.id ?? tool.key}`, tool });
      return;
    }
    const previous = rows.at(-1);
    if (previous?.kind === 'tools') {
      previous.tools.push(tool);
    } else {
      rows.push({ kind: 'tools', key: tool.key, tools: [tool] });
    }
  }
  for (const [messageIndex, message] of messages.entries()) {
    const key = String(messageIndex);
    if (message.role === 'toolResult') {
      const id = typeof message.toolCallId === 'string' ? message.toolCallId : undefined;
      const matched = id ? calls.get(id) : undefined;
      const output = messageBlocks(message)
        .map((block) => block.text)
        .join('\n\n');
      if (matched && matched.status === 'unknown') {
        matched.result = message;
        matched.output = output;
        matched.status = message.isError === true ? 'error' : 'complete';
      } else {
        // History can start after a call or contain results without an ID. Keep them visible.
        addTool({
          key,
          id,
          name: String(message.toolName ?? 'Tool output'),
          result: message,
          output,
          status: message.isError === true ? 'error' : 'complete',
        });
      }
      continue;
    }
    if (message.role !== 'assistant' || typeof message.content === 'string') {
      if (
        message.role !== 'assistant' ||
        (typeof message.content === 'string' && message.content.trim())
      ) {
        rows.push({ kind: 'message', key, role: message.role, blocks: messageBlocks(message) });
      }
      continue;
    }
    let blocks: ContentBlock[] = [];
    let segment = 0;
    function flush() {
      if (blocks.length) {
        rows.push({
          kind: 'message',
          key: `${key}:message:${segment++}`,
          role: message.role,
          blocks,
        });
        blocks = [];
      }
    }
    for (const [partIndex, part] of (message.content ?? []).entries()) {
      if (part.type === 'toolCall') {
        flush();
        const tool: ToolEntry = {
          key: `${key}:tool:${partIndex}`,
          id: typeof part.id === 'string' ? part.id : undefined,
          args: part.arguments,
          name: String(part.name ?? 'Tool'),
          preview: toolPreview(part.arguments),
          arguments: JSON.stringify(part.arguments ?? {}, null, 2),
          status: 'unknown',
        };
        addTool(tool);
        if (typeof part.id === 'string') {
          calls.set(part.id, tool);
        }
      } else if (part.type !== 'thinking') {
        blocks.push(
          ...messageBlocks({ ...message, content: [part] }).filter(
            (block) => block.kind !== 'text' || block.text.trim(),
          ),
        );
      }
    }
    flush();
  }
  for (const tool of active) {
    const matched = calls.get(tool.id);
    if (matched) {
      if (matched.status === 'unknown') {
        matched.status = 'running';
        matched.preview = toolPreview(tool.args) ?? matched.preview;
        if (tool.result !== undefined) {
          matched.output = JSON.stringify(tool.result, null, 2);
        }
      }
    } else {
      addTool({
        key: `active:${tool.id}`,
        id: tool.id,
        args: tool.args,
        name: tool.name,
        preview: toolPreview(tool.args),
        arguments: JSON.stringify(tool.args, null, 2),
        output: tool.result === undefined ? undefined : JSON.stringify(tool.result, null, 2),
        status: 'running',
      });
    }
  }
  const projected: ConversationRow[] = [];
  for (const row of rows) {
    if (row.kind !== 'tools') {
      projected.push(row);
      continue;
    }
    let tools: ToolEntry[] = [];
    const flush = () => {
      if (tools.length) {
        projected.push({ kind: 'tools', key: tools[0]?.key ?? row.key, tools });
      }
      tools = [];
    };
    for (const tool of row.tools) {
      const artifact = displayArtifact(tool.result);
      if (artifact) {
        flush();
        projected.push({ kind: 'display', key: `display:${tool.id ?? tool.key}`, artifact });
      } else {
        tools.push(tool);
      }
    }
    flush();
  }
  return projected;
}
