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
