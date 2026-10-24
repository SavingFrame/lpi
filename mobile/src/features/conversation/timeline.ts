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

const detailCache = new WeakMap<ToolEntry, { arguments?: string; output?: string }>();
const callCache = new WeakMap<Record<string, unknown>, ToolEntry>();
const codemodeCache = new WeakMap<
  Message,
  { args: unknown; state: ReturnType<typeof codemodeState> }
>();
const artifactCache = new WeakMap<Message, DisplayArtifact | undefined>();

/** Called only by mounted, open spoilers. Cache formatting without retaining old snapshots. */
export function toolDetails(tool: ToolEntry) {
  const cached = detailCache.get(tool);
  if (cached) {
    return cached;
  }
  const details = {
    arguments: 'args' in tool ? JSON.stringify(tool.args ?? {}, null, 2) : undefined,
    output: tool.result
      ? messageBlocks(tool.result)
          .map((block) => block.text)
          .join('\n\n')
      : tool.progress === undefined
        ? undefined
        : JSON.stringify(tool.progress, null, 2),
  };
  detailCache.set(tool, details);
  return details;
}

function callEntry(part: Record<string, unknown>, key: string): ToolEntry {
  const cached = callCache.get(part);
  if (cached?.key === key) {
    return { ...cached };
  }
  const tool: ToolEntry = {
    key,
    id: typeof part.id === 'string' ? part.id : undefined,
    args: part.arguments,
    name: String(part.name ?? 'Tool'),
    preview: part.name === 'codemode' ? undefined : toolPreview(part.arguments),
    status: 'unknown',
  };
  callCache.set(part, tool);
  // Pairing a result updates only this projection, never the cached call template.
  return { ...tool };
}

function projectCodemode(tool: ToolEntry, children: ToolActivity[] | undefined) {
  const cached = tool.result ? codemodeCache.get(tool.result) : undefined;
  if (cached && cached.args === tool.args) {
    return cached.state;
  }
  const state = codemodeState(tool, children);
  if (tool.result) {
    codemodeCache.set(tool.result, { args: tool.args, state });
  }
  return state;
}

/** Presentation only. Correlate results by tool ID, never by name or timestamp. */
export function conversationRows(messages: Message[], active: ToolActivity[]): ConversationRow[] {
  const rows: (
    | Exclude<ConversationRow, { kind: 'codemode' }>
    | { kind: 'codemode'; key: string; tool: ToolEntry }
  )[] = [];
  const calls = new Map<string, ToolEntry>();
  function addTool(tool: ToolEntry) {
    if (tool.name === 'codemode') {
      rows.push({ kind: 'codemode', key: tool.key, tool });
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
      if (matched && matched.status === 'unknown') {
        matched.result = message;
        matched.status = message.isError === true ? 'error' : 'complete';
      } else {
        // History can start after a call or contain results without an ID. Keep them visible.
        addTool({
          key: id ? `tool:${id}` : key,
          id,
          name: String(message.toolName ?? 'Tool output'),
          result: message,
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
        const tool = callEntry(
          part,
          typeof part.id === 'string' ? `tool:${part.id}` : `${key}:tool:${partIndex}`,
        );
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
      }
    } else {
      addTool({
        key: `tool:${tool.id}`,
        id: tool.id,
        args: tool.args,
        progress: tool.result,
        name: tool.name,
        preview: toolPreview(tool.args),
        status: 'running',
      });
    }
  }
  const projected: ConversationRow[] = [];
  for (const row of rows) {
    if (row.kind === 'codemode') {
      const state = projectCodemode(row.tool, children.get(row.tool.id ?? ''));
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
      if (tool.result && !artifactCache.has(tool.result)) {
        artifactCache.set(tool.result, displayArtifact(tool.result));
      }
      const artifact = tool.result ? artifactCache.get(tool.result) : undefined;
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
  let previousTools = new Map<string, ToolEntry>();
  return (messages: Message[], active: ToolActivity[], running = false): ConversationRow[] => {
    const rows: ConversationRow[] = [];
    const waiting = new Set<string>();
    for (const row of conversationRows(messages, active)) {
      if ('parentKey' in row && waiting.has(row.parentKey)) {
        continue;
      }
      if (row.kind === 'tools') {
        row.tools = row.tools.map((tool) => {
          const old = previousTools.get(tool.key);
          return old && sameFields(old, tool) ? old : tool;
        });
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
    previousTools = new Map(
      rows.flatMap((row) =>
        row.kind === 'tools' ? row.tools.map((tool) => [tool.key, tool] as const) : [],
      ),
    );
    return rows;
  };
}
