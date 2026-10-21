import { buildSessionProjection, type SessionEntry } from '@earendil-works/pi-coding-agent';
import type { TreeNode } from './shared/session-tree.js';
import { promptTitle } from './shared/sessions.js';

/** Preserve native entry provenance through context edits and compaction. */
export function historyMessages(entries: SessionEntry[], leafId?: string | null) {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.id || seen.has(entry.id) || (entry.parentId !== null && !seen.has(entry.parentId))) {
      throw new Error('Invalid Pi history ancestry');
    }
    seen.add(entry.id);
  }
  return buildSessionProjection(entries, leafId).entries.flatMap(({ sourceEntry, messages }) =>
    messages.map((message) => ({
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
