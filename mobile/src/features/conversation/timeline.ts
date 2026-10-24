import type { Message, ToolActivity } from '../../../../src/shared/client-state';
import { type CodemodeCall, codemodeState } from '../../../../src/shared/codemode.ts';
import { type DisplayArtifact, displayArtifact } from '../../../../src/shared/display.ts';
import { type ContentBlock, messageBlocks } from './content.ts';

export interface ToolEntry {
  key: string;
  id?: string;
  args?: unknown;
  result?: Message;
  progress?: unknown;
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
  | { kind: 'question'; key: string; tool: ToolEntry }
  | { kind: 'codemode'; key: string; tool: ToolEntry; state: ReturnType<typeof codemodeState> }
  | { kind: 'codemode-call'; key: string; parentKey: string; call: CodemodeCall }
  | {
      kind: 'codemode-details';
      key: string;
      parentKey: string;
      tool: ToolEntry;
      state: ReturnType<typeof codemodeState>;
    };

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
    if (tool.name === 'codemode') {
      rows.push({ kind: 'codemode', key: tool.key, tool, state: codemodeState(tool) });
      return;
    }
    if (tool.name === 'ask_user_question') {
      rows.push({ kind: 'question', key: `question:${tool.id ?? tool.key}`, tool });
      return;
    }
    const previous = rows.at(-1);
    // FlatList cannot virtualize controls inside a row. Keep long tool-only runs bounded.
    if (previous?.kind === 'tools' && previous.tools.length < 12) {
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
      const output =
        message.toolName === 'codemode'
          ? undefined
          : messageBlocks(message)
              .map((block) => block.text)
              .join('\n\n');
      if (matched && matched.status === 'unknown') {
        matched.result = message;
        matched.output = output;
        matched.status = message.isError === true ? 'error' : 'complete';
      } else {
        // History can start after a call or contain results without an ID. Keep them visible.
        addTool({
          key: id ? `tool:${id}` : key,
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
          key: typeof part.id === 'string' ? `tool:${part.id}` : `${key}:tool:${partIndex}`,
          id: typeof part.id === 'string' ? part.id : undefined,
          args: part.arguments,
          name: String(part.name ?? 'Tool'),
          preview: toolPreview(part.arguments),
          arguments:
            part.name === 'codemode' ? undefined : JSON.stringify(part.arguments ?? {}, null, 2),
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
  const activeById = new Map(active.map((tool) => [tool.id, tool]));
  const children = new Map<string, ToolActivity[]>();
  const nested = new Set<string>();
  for (const tool of active) {
    let parent = tool.parentToolCallId;
    const visited = new Set<string>([tool.id]);
    while (parent && !visited.has(parent)) {
      visited.add(parent);
      if ((calls.get(parent) ?? activeById.get(parent))?.name === 'codemode') {
        const group = children.get(parent) ?? [];
        group.push(tool);
        children.set(parent, group);
        nested.add(tool.id);
        break;
      }
      parent = activeById.get(parent)?.parentToolCallId;
    }
  }
  for (const tool of active) {
    if (nested.has(tool.id)) {
      continue;
    }
    const matched = calls.get(tool.id);
    if (matched) {
      if (matched.status === 'unknown') {
        matched.status = 'running';
        matched.progress = tool.result;
        matched.preview = toolPreview(tool.args) ?? matched.preview;
        if (tool.result !== undefined && tool.name !== 'codemode') {
          matched.output = JSON.stringify(tool.result, null, 2);
        }
      }
    } else {
      addTool({
        key: `tool:${tool.id}`,
        id: tool.id,
        args: tool.args,
        progress: tool.result,
        name: tool.name,
        preview: toolPreview(tool.args),
        arguments: tool.name === 'codemode' ? undefined : JSON.stringify(tool.args, null, 2),
        output:
          tool.name === 'codemode' || tool.result === undefined
            ? undefined
            : JSON.stringify(tool.result, null, 2),
        status: 'running',
      });
    }
  }
  const projected: ConversationRow[] = [];
  for (const row of rows) {
    if (row.kind === 'codemode') {
      const state = codemodeState(row.tool, children.get(row.tool.id ?? ''));
      projected.push({ ...row, state });
      for (const call of state.calls) {
        projected.push({
          kind: 'codemode-call',
          key: `${row.key}:call:${call.key}`,
          parentKey: row.key,
          call,
        });
      }
      projected.push({
        kind: 'codemode-details',
        key: `${row.key}:details`,
        parentKey: row.key,
        tool: row.tool,
        state,
      });
      continue;
    }
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

function sameFields<T extends object>(left: T, right: T): boolean {
  const keys = Object.keys(left) as (keyof T)[];
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

function sameRow(left: ConversationRow, right: ConversationRow): boolean {
  if (left.kind === 'message' && right.kind === 'message') {
    return (
      left.role === right.role &&
      left.blocks.length === right.blocks.length &&
      left.blocks.every((block, index) => {
        const other = right.blocks[index];
        return other !== undefined && sameFields(block, other);
      })
    );
  }
  if (left.kind === 'tools' && right.kind === 'tools') {
    return (
      left.tools.length === right.tools.length &&
      left.tools.every((tool, index) => {
        const other = right.tools[index];
        return other !== undefined && sameFields(tool, other);
      })
    );
  }
  if (left.kind === 'codemode-call' && right.kind === 'codemode-call') {
    return left.parentKey === right.parentKey && sameFields(left.call, right.call);
  }
  if (
    (left.kind === 'codemode' && right.kind === 'codemode') ||
    (left.kind === 'codemode-details' && right.kind === 'codemode-details')
  ) {
    return (
      sameFields(left.tool, right.tool) && left.state.calls.length === right.state.calls.length
    );
  }
  if (left.kind === 'question' && right.kind === 'question') {
    return sameFields(left.tool, right.tool);
  }
  if (left.kind === 'display' && right.kind === 'display') {
    return sameFields(left.artifact, right.artifact);
  }
  return false;
}

/** Per-mounted-transcript cache. Retain only the current rows, never old live snapshots. */
export function createConversationRows() {
  let previous = new Map<string, ConversationRow>();
  return (messages: Message[], active: ToolActivity[], running = false): ConversationRow[] => {
    const rows: ConversationRow[] = [];
    const waiting = new Set<string>();
    for (const row of conversationRows(messages, active)) {
      if ('parentKey' in row && waiting.has(row.parentKey)) {
        continue;
      }
      const old = previous.get(row.key);
      if (
        running &&
        row.kind === 'codemode' &&
        old?.kind === 'codemode' &&
        !row.tool.result &&
        row.tool.args === old.tool.args &&
        row.state.calls.length < old.state.calls.length
      ) {
        // Native tool-end precedes the saved result. Do not briefly empty the group.
        rows.push(old);
        for (const child of previous.values()) {
          if ('parentKey' in child && child.parentKey === row.key) {
            rows.push(child);
          }
        }
        waiting.add(row.key);
      } else {
        rows.push(old && sameRow(old, row) ? old : row);
      }
    }
    previous = new Map(rows.map((row) => [row.key, row]));
    return rows;
  };
}
