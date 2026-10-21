import type { Message, View } from '../../src/shared/client-state.ts';

export interface TranscriptTool {
  name: string;
  args: unknown;
  result?: Message;
  progress?: unknown;
  status: 'Running' | 'Completed' | 'Failed' | 'Pending' | 'No result';
}

interface TranscriptGroup {
  key: string;
  messageKeys: string[];
  role: string;
  author: string;
  messages: Message[];
  streaming: boolean;
}

export type TranscriptEntry =
  | { kind: 'message'; key: string; item: Message; source: Message; actions: boolean }
  | { kind: 'tools'; key: string; tools: { key: string; tool: TranscriptTool }[] };

/** Group adjacent ordinary calls, including calls in separate assistant messages. */
export function transcriptEntries(
  messages: Message[],
  keys: string[],
  tools: Map<string, TranscriptTool>,
): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const [index, source] of messages.entries()) {
    const key = keys[index] ?? `${source.role}:${source.timestamp}:${index}`;
    if (
      source.role !== 'assistant' ||
      !Array.isArray(source.content) ||
      !source.content.some((block) => {
        const tool =
          block.type === 'toolCall' && typeof block.id === 'string'
            ? tools.get(block.id)
            : undefined;
        return tool && tool.name !== 'codemode';
      })
    ) {
      entries.push({ kind: 'message', key, item: source, source, actions: true });
      continue;
    }
    const lastText = source.content.findLastIndex(
      (block) => block.type === 'text' && typeof block.text === 'string' && block.text.trim(),
    );
    let content: Record<string, unknown>[] = [];
    let start = 0;
    const flush = (end: number) => {
      if (content.length === 0) {
        return;
      }
      entries.push({
        kind: 'message',
        key: `${key}:${start}`,
        item: {
          ...source,
          content,
          summary: undefined,
          output: undefined,
          errorMessage: undefined,
        },
        source,
        actions: lastText >= start && lastText < end,
      });
      content = [];
    };
    for (const [blockIndex, block] of source.content.entries()) {
      const tool =
        block.type === 'toolCall' && typeof block.id === 'string' ? tools.get(block.id) : undefined;
      if (!tool || tool.name === 'codemode') {
        if (content.length === 0) {
          start = blockIndex;
        }
        content.push(block);
        continue;
      }
      flush(blockIndex);
      const previous = entries.at(-1);
      if (previous?.kind === 'tools') {
        previous.tools.push({ key: String(block.id), tool });
      } else {
        entries.push({
          kind: 'tools',
          key: `${key}:${blockIndex}`,
          tools: [{ key: String(block.id), tool }],
        });
      }
    }
    flush(source.content.length);
    if (
      source.summary !== undefined ||
      source.output !== undefined ||
      source.errorMessage !== undefined ||
      source.content.length === 0
    ) {
      entries.push({
        kind: 'message',
        key: `${key}:tail`,
        item: { ...source, content: [] },
        source,
        actions: lastText === -1,
      });
    }
  }
  return entries;
}

/** Text available to message actions, excluding reasoning and tool content. */
export function messageActionText(item: Message): string | null {
  if (item.role !== 'user' && item.role !== 'assistant') {
    return null;
  }
  const text =
    typeof item.content === 'string'
      ? item.content
      : (item.content ?? [])
          .filter((block) => block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('\n\n');
  return item.role === 'user' || text.trim() ? text : null;
}

/** Only completed conversation boundaries get actions, not intermediate agent steps. */
export function messageActionTargets(view: View): Set<Message> {
  const targets = new Set<Message>();
  let previous: Message | undefined;
  const finish = () => {
    if (
      previous?.role === 'assistant' &&
      (previous.stopReason === undefined || previous.stopReason === 'stop') &&
      !(
        Array.isArray(previous.content) &&
        previous.content.some((block) => block.type === 'toolCall')
      ) &&
      messageActionText(previous) !== null
    ) {
      targets.add(previous);
    }
  };
  for (const item of view.messages) {
    if (item.role === 'system' || item.display === false) {
      continue;
    }
    if (item.role === 'user') {
      finish();
      targets.add(item);
    }
    previous = item;
  }
  if (!view.running && !view.compacting && !view.partial && view.tools.length === 0) {
    finish();
  }
  return targets;
}

export function transcriptState(view: View) {
  const visible = view.messages.filter((item) => item.role !== 'system' && item.display !== false);
  const tools = new Map<string, TranscriptTool>();
  for (const item of [...visible, ...(view.partial ? [view.partial] : [])]) {
    if (item.role !== 'assistant' || !Array.isArray(item.content)) {
      continue;
    }
    for (const block of item.content) {
      if (block.type === 'toolCall' && typeof block.id === 'string') {
        tools.set(block.id, {
          name: String(block.name),
          args: block.arguments,
          status: view.running ? 'Pending' : 'No result',
        });
      }
    }
  }
  const unpaired = view.tools.filter((tool) => !tools.has(tool.id));
  for (const tool of view.tools) {
    tools.set(tool.id, {
      name: tool.name,
      args: tool.args,
      progress: tool.result,
      status: 'Running',
    });
  }
  const messages = visible.filter((item) => {
    if (item.role !== 'toolResult' || typeof item.toolCallId !== 'string') {
      return true;
    }
    const tool = tools.get(item.toolCallId);
    if (!tool) {
      return true;
    }
    tools.set(item.toolCallId, {
      ...tool,
      result: item,
      status: item.isError === true ? 'Failed' : 'Completed',
    });
    return false;
  });
  const groups: TranscriptGroup[] = [];
  for (const [position, item] of [...messages, ...(view.partial ? [view.partial] : [])].entries()) {
    // Native messages are append-only within a branch. Include position because timestamps can repeat.
    const key = `${item.role}:${item.timestamp}:${position}`;
    const author =
      item.role === 'user'
        ? 'You'
        : item.role === 'assistant'
          ? 'Pi'
          : String(item.toolName ?? item.role);
    let group = groups.at(-1);
    if (!group || group.role !== item.role || group.author !== author) {
      group = { key, messageKeys: [], role: item.role, author, messages: [], streaming: false };
      groups.push(group);
    }
    group.messages.push(item);
    group.messageKeys.push(key);
    group.streaming ||= item === view.partial;
  }
  return { messages, tools, unpaired, groups };
}
