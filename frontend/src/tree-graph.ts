import type { SessionTree } from '../../src/shared/session-tree.ts';

export interface GraphRow {
  id: string;
  entryId?: string;
  segmentId: string;
  type: 'message' | 'path';
  title: string;
  kind: string;
  depth: number;
  count: number;
  active: boolean;
  selected: boolean;
  exactActive: boolean;
  expanded: boolean;
  context: boolean;
}

export interface OutlineGroup {
  id: string;
  header: GraphRow | null;
  messages: GraphRow[];
  children: OutlineGroup[];
}

export interface GraphOptions {
  showAll: boolean;
  search: string;
  selectedId?: string;
  paths: ReadonlyMap<string, boolean>;
}

interface Node {
  id: string;
  parentId: string | null;
  title: string;
  kind: string;
  children: Node[];
  active: boolean;
  selected: boolean;
  exactActive: boolean;
  context: boolean;
}

interface Segment {
  id: string;
  nodes: Node[];
  children: Segment[];
  count: number;
  active: boolean;
  selected: boolean;
}

/** Use the same projection for the branch count and default conversation outline. */
function projectTree(tree: SessionTree, showAll: boolean) {
  const nodes = new Map<string, Node>();
  const nearest = new Map<string, string | null>();
  const roots: Node[] = [];
  for (const node of tree.nodes) {
    const parentId = node.parentId === null ? null : (nearest.get(node.parentId) ?? null);
    const visible =
      showAll ||
      node.kind === 'user' ||
      (node.kind === 'assistant' && Boolean(node.preview.trim() || node.label));
    nearest.set(node.id, visible ? node.id : parentId);
    if (!visible) {
      continue;
    }
    const projected: Node = {
      id: node.id,
      parentId,
      kind: node.kind,
      title:
        node.label ||
        node.preview ||
        (node.kind === 'user' ? 'Image or empty prompt' : node.kind.replaceAll('_', ' ')),
      children: [],
      active: false,
      selected: false,
      exactActive: false,
      context: false,
    };
    nodes.set(node.id, projected);
    const siblings = parentId === null ? roots : nodes.get(parentId)?.children;
    siblings?.push(projected);
  }
  return { nodes, nearest, roots };
}

/** Metadata-only side paths do not create additional conversation branches. */
export function conversationBranchCount(tree: SessionTree): number {
  const { nodes } = projectTree(tree, false);
  let count = 0;
  for (const node of nodes.values()) {
    if (node.children.length === 0) {
      count++;
    }
  }
  return count;
}

/** Linear messages stay aligned; every child of a split is an equal, collapsible group. */
export function sessionGraph(tree: SessionTree, options: GraphOptions) {
  const projection = projectTree(tree, options.showAll);
  const { nodes, nearest } = projection;
  let roots = projection.roots;
  const term = options.search.trim().toLowerCase();
  for (const node of nodes.values()) {
    node.context =
      Boolean(term) && !`${node.kind} ${node.title} ${node.id}`.toLowerCase().includes(term);
  }
  const activeId = tree.connected && tree.activeLeafId ? nearest.get(tree.activeLeafId) : null;
  const selectedId = options.selectedId ? nearest.get(options.selectedId) : null;
  const active = activeId ? nodes.get(activeId) : undefined;
  if (active) {
    active.active = true;
    active.exactActive = active.id === tree.activeLeafId;
  }
  const selected = selectedId ? nodes.get(selectedId) : undefined;
  if (selected) {
    selected.selected = true;
  }
  if (term) {
    const retained = new Set<string>();
    for (const node of nodes.values()) {
      if (node.context) {
        continue;
      }
      let id: string | null = node.id;
      while (id && !retained.has(id)) {
        retained.add(id);
        id = nodes.get(id)?.parentId ?? null;
      }
    }
    for (const node of nodes.values()) {
      node.children = node.children.filter((child) => retained.has(child.id));
    }
    roots = roots.filter((node) => retained.has(node.id));
  }
  const segments: Segment[] = [];
  const allSegments: Segment[] = [];
  const pending = roots.map((node) => ({ node, siblings: segments })).reverse();
  while (pending.length) {
    const task = pending.pop();
    if (!task) {
      break;
    }
    const chain = [task.node];
    let end = task.node;
    while (end.children.length === 1) {
      const child = end.children[0];
      if (!child) {
        break;
      }
      end = child;
      chain.push(end);
    }
    const segment: Segment = {
      id: task.node.id,
      nodes: chain,
      children: [],
      count: chain.length,
      active: chain.some((node) => node.active),
      selected: chain.some((node) => node.selected),
    };
    task.siblings.push(segment);
    allSegments.push(segment);
    for (const child of [...end.children].reverse()) {
      pending.push({ node: child, siblings: segment.children });
    }
  }
  for (const segment of [...allSegments].reverse()) {
    for (const child of segment.children) {
      segment.count += child.count;
      segment.active ||= child.active;
      segment.selected ||= child.selected;
    }
  }
  const groups: OutlineGroup[] = [];
  const rows: GraphRow[] = [];
  const tasks = segments
    .map((segment) => ({ segment, siblings: groups, depth: roots.length > 1 ? 1 : 0 }))
    .reverse();
  while (tasks.length) {
    const task = tasks.pop();
    if (!task) {
      break;
    }
    const { segment, depth } = task;
    const first = segment.nodes[0];
    if (!first) {
      continue;
    }
    const expanded = depth === 0 || Boolean(term) || (options.paths.get(segment.id) ?? true);
    const base = {
      segmentId: segment.id,
      depth,
      count: segment.count,
      active: segment.active,
      selected: segment.selected,
      exactActive: false,
      expanded,
      context: false,
    };
    const header: GraphRow | null =
      depth === 0
        ? null
        : {
            ...base,
            id: `path:${segment.id}`,
            type: 'path',
            kind: 'path',
            title: first.title,
          };
    const group: OutlineGroup = { id: segment.id, header, messages: [], children: [] };
    task.siblings.push(group);
    if (header) {
      rows.push(header);
    }
    if (!expanded) {
      continue;
    }
    for (const node of segment.nodes) {
      const row: GraphRow = {
        ...base,
        id: node.id,
        entryId: node.id,
        type: 'message',
        title: node.title,
        kind: node.kind,
        active: node.active,
        selected: node.selected,
        exactActive: node.exactActive,
        context: node.context,
        count: 1,
      };
      group.messages.push(row);
      rows.push(row);
    }
    for (const child of [...segment.children].reverse()) {
      tasks.push({ segment: child, siblings: group.children, depth: depth + 1 });
    }
  }
  return { groups, rows, messageCount: [...nodes.values()].filter((node) => !node.context).length };
}
