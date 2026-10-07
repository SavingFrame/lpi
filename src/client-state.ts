// Shared, dependency-free browser projection of validated RPC records.
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
  steering: string[];
  followUp: string[];
  running: boolean;
  compacting: boolean;
  notice: string | null;
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
    steering: [],
    followUp: [],
    running: false,
    compacting: false,
    notice: null,
  };
}

export function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('Invalid string list');
  }
  return value as string[];
}

export function reduceRpc(view: View, rpc: Record<string, unknown>): View {
  const next = { ...view };
  switch (rpc.type) {
    case 'agent_start':
    case 'auto_retry_start':
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
    case 'queue_update':
      next.steering = strings(rpc.steering);
      next.followUp = strings(rpc.followUp);
      break;
    case 'message_start': {
      const item = message(rpc.message);
      if (item.role === 'assistant') {
        next.partial = item;
      }
      break;
    }
    case 'message_end': {
      const item = message(rpc.message);
      // Deduplication belongs to the event cursor. Timestamps are not unique IDs.
      next.messages = [...view.messages, item];
      if (item.role === 'assistant') {
        next.partial = null;
      }
      break;
    }
    case 'message_update': {
      if (!view.partial) {
        throw new Error('Streaming update without message_start');
      }
      const update = record(rpc.assistantMessageEvent);
      const index = update.contentIndex;
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 4096) {
        break;
      }
      const content = Array.isArray(view.partial.content) ? [...view.partial.content] : [];
      const block = { ...content[index] };
      switch (update.type) {
        case 'text_start':
          content[index] = { type: 'text', text: '' };
          break;
        case 'thinking_start':
          content[index] = { type: 'thinking', thinking: '' };
          break;
        case 'text_delta':
          content[index] = {
            ...block,
            type: 'text',
            text: String(block.text ?? '') + String(update.delta ?? ''),
          };
          break;
        case 'thinking_delta':
          content[index] = {
            ...block,
            type: 'thinking',
            thinking: String(block.thinking ?? '') + String(update.delta ?? ''),
          };
          break;
        case 'text_end':
          content[index] = { ...block, type: 'text', text: update.content };
          break;
        case 'thinking_end':
          content[index] = { ...block, type: 'thinking', thinking: update.content };
          break;
        case 'toolcall_start':
          content[index] = {
            type: 'toolCall',
            id: update.id,
            name: update.toolName,
            argumentsText: '',
          };
          break;
        case 'toolcall_delta':
          content[index] = {
            ...block,
            argumentsText: String(block.argumentsText ?? '') + String(update.delta ?? ''),
          };
          break;
        case 'toolcall_end':
          content[index] = record(update.toolCall);
          break;
      }
      next.partial = { ...view.partial, content, usage: rpc.usage };
      break;
    }
    case 'tool_execution_start':
    case 'tool_execution_update': {
      if (typeof rpc.toolCallId !== 'string' || typeof rpc.toolName !== 'string') {
        throw new Error('Invalid tool event');
      }
      const tool = {
        id: rpc.toolCallId,
        name: rpc.toolName,
        args: rpc.args,
        result: rpc.partialResult,
      };
      next.tools = [...view.tools.filter((item) => item.id !== tool.id), tool];
      break;
    }
    case 'tool_execution_end':
      next.tools = view.tools.filter((item) => item.id !== rpc.toolCallId);
      break;
    case 'extension_ui_request':
      if (['select', 'confirm', 'input', 'editor'].includes(String(rpc.method))) {
        next.notice = 'This session requested a dialog. Browser answers are not implemented yet.';
      } else if (rpc.method === 'notify') {
        next.notice = String(rpc.message ?? 'Extension notification');
      }
      break;
    case 'extension_error':
      next.notice = String(rpc.error ?? 'Extension error');
      break;
  }
  return next;
}
