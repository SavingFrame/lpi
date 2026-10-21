import type { ComposerDraft } from '../../src/client/drafts.ts';
import { imageAttachments } from '../../src/shared/attachments.ts';
import type { BranchPreview, SessionTree } from '../../src/shared/session-tree.ts';

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

/** Every saved entry in ancestry order, including metadata and internal positions. */
export function fullTreeRows(tree: SessionTree): (BranchRow & { kind: string; split: boolean })[] {
  const children = new Map<string | null, SessionTree['nodes']>();
  for (const node of tree.nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  const pending = (children.get(null) ?? []).map((node) => ({ node, depth: 0 })).reverse();
  const rows: (BranchRow & { kind: string; split: boolean })[] = [];
  while (pending.length) {
    const current = pending.pop();
    if (!current) {
      break;
    }
    const { node, depth } = current;
    rows.push({
      id: node.id,
      kind: node.kind,
      title: node.label || node.preview || `${node.kind} ${node.id.slice(0, 8)}`,
      depth,
      split: (children.get(node.parentId)?.length ?? 0) > 1,
      active: tree.connected && tree.activeLeafId === node.id,
    });
    const successors = children.get(node.id) ?? [];
    for (let index = successors.length - 1; index >= 0; index--) {
      const child = successors[index];
      if (child) {
        pending.push({ node: child, depth: depth + (successors.length > 1 ? 1 : 0) });
      }
    }
  }
  return rows;
}

/** Hide implementation entries without losing topology or the native active path. */
export function visibleTreeRows(tree: SessionTree, showAll: boolean, search: string) {
  const visible = new Set(
    tree.nodes
      .filter(
        (node) =>
          showAll ||
          node.kind === 'user' ||
          (node.kind === 'assistant' && Boolean(node.preview.trim() || node.label)),
      )
      .map((node) => node.id),
  );
  const parents = new Map(tree.nodes.map((node) => [node.id, node.parentId]));
  let activeId = tree.connected ? tree.activeLeafId : null;
  while (activeId && !visible.has(activeId)) {
    activeId = parents.get(activeId) ?? null;
  }
  const term = search.trim().toLowerCase();
  return fullTreeRows(tree)
    .filter((row) => visible.has(row.id))
    .map((row) => ({
      ...row,
      active: row.id === activeId,
      exactActive: row.id === tree.activeLeafId,
    }))
    .filter((row) => `${row.kind} ${row.title} ${row.id}`.toLowerCase().includes(term));
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
