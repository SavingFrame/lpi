import { type Message, message, record } from './client-state.ts';
import { text } from './errors.ts';

export interface TreeNode {
  id: string;
  parentId: string | null;
  kind: string;
  preview: string;
  label?: string;
}

export interface SessionTree {
  sessionId: string;
  generation: number;
  /** Only connected native Pi can report its in-memory position. */
  connected: boolean;
  activeLeafId: string | null;
  nodes: TreeNode[];
}

export interface BranchPreview {
  sessionId: string;
  entryId: string;
  messages: Message[];
}

export function sessionTree(value: unknown): SessionTree {
  const raw = record(value);
  if (
    typeof raw.generation !== 'number' ||
    !Number.isSafeInteger(raw.generation) ||
    raw.generation < 0 ||
    typeof raw.connected !== 'boolean' ||
    (raw.activeLeafId !== null && typeof raw.activeLeafId !== 'string') ||
    !Array.isArray(raw.nodes) ||
    raw.nodes.length > 100_000
  ) {
    throw new Error('Invalid session tree');
  }
  const seen = new Set<string>();
  const nodes = raw.nodes.map((value) => {
    const node = record(value);
    const id = text(node.id, 'entry ID', 128);
    if (
      typeof node.preview !== 'string' ||
      node.preview.length > 160 ||
      seen.has(id) ||
      (node.parentId !== null && !seen.has(String(node.parentId))) ||
      (node.label !== undefined && (typeof node.label !== 'string' || node.label.length > 160))
    ) {
      throw new Error('Invalid session tree ancestry');
    }
    seen.add(id);
    return {
      id,
      parentId: node.parentId === null ? null : text(node.parentId, 'parent entry ID', 128),
      kind: text(node.kind, 'entry kind', 64),
      preview: node.preview,
      ...(typeof node.label === 'string' ? { label: node.label.slice(0, 160) } : {}),
    };
  });
  return {
    sessionId: text(raw.sessionId, 'session ID', 128),
    generation: raw.generation,
    connected: raw.connected,
    activeLeafId: raw.activeLeafId === null ? null : text(raw.activeLeafId, 'active entry ID', 128),
    nodes,
  };
}

export function branchPreview(value: unknown): BranchPreview {
  const raw = record(value);
  if (!Array.isArray(raw.messages)) {
    throw new Error('Invalid branch preview');
  }
  return {
    sessionId: text(raw.sessionId, 'session ID', 128),
    entryId: text(raw.entryId, 'entry ID', 128),
    messages: raw.messages.map(message),
  };
}
