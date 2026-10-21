import { type SessionEntry, sessionEntryToContextMessages } from '@earendil-works/pi-coding-agent';
import type { TreeNode } from './shared/session-tree.js';
import { promptTitle } from './shared/sessions.js';

/** Full branch transcript. Compaction and context edits affect model context, not history. */
export function historyMessages(entries: SessionEntry[], leafId?: string | null) {
  const byId = new Map<string, SessionEntry>();
  for (const entry of entries) {
    if (!entry.id || byId.has(entry.id) || (entry.parentId !== null && !byId.has(entry.parentId))) {
      throw new Error('Invalid Pi history ancestry');
    }
    byId.set(entry.id, entry);
  }
  const path: SessionEntry[] = [];
  let entry = leafId === null ? undefined : byId.get(leafId ?? entries.at(-1)?.id ?? '');
  while (entry) {
    path.push(entry);
    entry = entry.parentId === null ? undefined : byId.get(entry.parentId);
  }
  return path.reverse().flatMap((sourceEntry) =>
    sessionEntryToContextMessages(sourceEntry).map((message) => ({
      ...message,
      entryId: sourceEntry.id,
      ...(sourceEntry.type === 'custom_message' ? { entryType: 'custom_message' } : {}),
    })),
  );
}

/** Compact topology only. Image bytes, tool arguments, and results stay out of the tree. */
export function historyNodes(entries: SessionEntry[]): TreeNode[] {
  const labels = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type === 'label') {
      if (entry.label) {
        labels.set(entry.targetId, entry.label);
      } else {
        labels.delete(entry.targetId);
      }
    }
  }
  return entries.map((entry) => ({
    id: entry.id,
    parentId: entry.parentId,
    kind: entry.type === 'message' ? entry.message.role : entry.type,
    preview:
      entry.type === 'message'
        ? (promptTitle(
            entry.message.role === 'user' || entry.message.role === 'assistant'
              ? entry.message.content
              : '',
          ) ?? '')
        : entry.type === 'branch_summary' || entry.type === 'compaction'
          ? (promptTitle(entry.summary) ?? '')
          : entry.type === 'custom_message'
            ? (promptTitle(entry.content) ?? '')
            : '',
    ...(labels.has(entry.id) ? { label: labels.get(entry.id)?.slice(0, 160) } : {}),
  }));
}
