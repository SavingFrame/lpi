import { imageAttachments } from '../../src/shared/attachments.ts';
import type { BranchPreview, SessionTree } from '../../src/shared/session-tree.ts';
import type { ComposerDraft } from './session/draft.ts';

/** Native /tree rewinds before a selected user message. Restore its structured draft. */
export function draftForBranch(preview: BranchPreview): ComposerDraft | null {
  const target = preview.messages.find(
    (message) =>
      message.entryId === preview.entryId &&
      (message.role === 'user' || message.entryType === 'custom_message'),
  );
  if (!target) {
    return null;
  }
  return {
    text:
      typeof target.content === 'string'
        ? target.content
        : (target.content ?? [])
            .filter((part) => part.type === 'text')
            .map((part) => String(part.text ?? ''))
            .join('\n'),
    images: imageAttachments(
      Array.isArray(target.content) ? target.content.filter((part) => part.type === 'image') : [],
    ),
  };
}

export interface BranchRow {
  id: string;
  title: string;
  depth: number;
  active: boolean;
}

/** Collapse linear stretches into branch tips, retaining a rewound active position. */
export function branchRows(tree: SessionTree): BranchRow[] {
  const children = new Map<string | null, SessionTree['nodes']>();
  for (const node of tree.nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  const paths = new Map<
    string,
    { prompt: string; label: string; depth: number; conversation: boolean }
  >();
  const rows: BranchRow[] = [];
  const pending = [...(children.get(null) ?? [])].reverse();
  while (pending.length) {
    const node = pending.pop();
    if (!node) {
      break;
    }
    const successors = children.get(node.id) ?? [];
    for (let index = successors.length - 1; index >= 0; index--) {
      const child = successors[index];
      if (child) {
        pending.push(child);
      }
    }
    const parent = node.parentId === null ? undefined : paths.get(node.parentId);
    const split = node.parentId !== null && (children.get(node.parentId)?.length ?? 0) > 1;
    const path = {
      prompt: split ? '' : (parent?.prompt ?? ''),
      label: split ? '' : (parent?.label ?? ''),
      depth: (parent?.depth ?? 0) + (split ? 1 : 0),
      conversation:
        (parent?.conversation ?? false) || node.kind === 'user' || node.kind === 'assistant',
    };
    if (node.label) {
      path.label = node.label;
    }
    if (!path.prompt && node.kind === 'user') {
      path.prompt = node.preview;
    }
    paths.set(node.id, path);
    const active = tree.connected && tree.activeLeafId === node.id;
    if (path.conversation && (successors.length === 0 || active)) {
      rows.push({
        id: node.id,
        title: path.label || path.prompt || node.preview || `Branch ${node.id.slice(0, 8)}`,
        depth: path.depth,
        active,
      });
    }
  }
  return rows;
}
