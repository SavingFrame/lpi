import { type ExtensionSnapshots, extensionSnapshots } from './extension-support/registry.ts';

// Shared, browser-safe projection of native Pi events.
export interface Message {
  role: string;
  timestamp: number;
  content?: string | Record<string, unknown>[];
  [key: string]: unknown;
}

export interface ToolActivity {
  id: string;
  name: string;
  args: unknown;
  result?: unknown;
}

export interface View {
  messages: Message[];
  partial: Message | null;
  tools: ToolActivity[];
  running: boolean;
  compacting: boolean;
  notice: string | null;
  extensions: ExtensionSnapshots;
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected an object');
  }
  return value as Record<string, unknown>;
}

export function message(value: unknown): Message {
  const raw = record(value);
  if (
    typeof raw.role !== 'string' ||
    typeof raw.timestamp !== 'number' ||
    !Number.isFinite(raw.timestamp)
  ) {
    throw new Error('Invalid message');
  }
  if (raw.content !== undefined && typeof raw.content !== 'string') {
    if (!Array.isArray(raw.content)) {
      throw new Error('Invalid message content');
    }
    return { ...raw, role: raw.role, timestamp: raw.timestamp, content: raw.content.map(record) };
  }
  return { ...raw, role: raw.role, timestamp: raw.timestamp, content: raw.content };
}

export function emptyView(): View {
  return {
    messages: [],
    partial: null,
    tools: [],
    running: false,
    compacting: false,
    notice: null,
    extensions: {},
  };
}

export function reduceEvent(view: View, event: Record<string, unknown>): View {
  const next = { ...view };
  switch (event.type) {
    case 'extension_support':
      if (event.notice !== null && typeof event.notice !== 'string') {
        throw new Error('Invalid extension support notice');
      }
      next.extensions = extensionSnapshots(event.extensions);
      next.notice = event.notice;
      break;
    case 'agent_start':
      next.running = true;
      break;
    case 'agent_settled':
      next.running = false;
      next.partial = null;
      next.tools = [];
      break;
    case 'compaction_start':
      next.compacting = true;
      break;
    case 'compaction_end':
      next.compacting = false;
      break;
    case 'message_start': {
      const item = message(event.message);
      if (item.role === 'assistant') {
        next.partial = item;
      }
      break;
    }
    case 'message_end': {
      const item = message(event.message);
      // Deduplication belongs to the event cursor. Timestamps are not unique IDs.
      next.messages = [...view.messages, item];
      if (item.role === 'assistant') {
        next.partial = null;
      }
      break;
    }
    case 'message_update':
      next.partial = message(event.message);
      break;
    case 'tool_execution_start':
    case 'tool_execution_update': {
      if (typeof event.toolCallId !== 'string' || typeof event.toolName !== 'string') {
        throw new Error('Invalid tool event');
      }
      const tool = {
        id: event.toolCallId,
        name: event.toolName,
        args: event.args,
        result: event.partialResult,
      };
      next.tools = [...view.tools.filter((item) => item.id !== tool.id), tool];
      break;
    }
    case 'tool_execution_end':
      next.tools = view.tools.filter((item) => item.id !== event.toolCallId);
      break;
  }
  return next;
}
