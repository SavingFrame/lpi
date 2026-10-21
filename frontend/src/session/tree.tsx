import { useQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  Maximize2,
  Minimize2,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Session } from '../../../src/shared/sessions';
import { live } from '../client';
import { Button } from '../components/ui/button';
import { conversationBranchCount, type OutlineGroup, sessionGraph } from '../tree-graph';
import { sessionTreeQuery } from '../tree-query';
import { requestBranchSelection } from './branch-navigation';

function TreeOutlineGroup({
  group,
  session,
  showAll,
  searching,
  onToggle,
}: {
  group: OutlineGroup;
  session: Session;
  showAll: boolean;
  searching: boolean;
  onToggle: (id: string, expanded: boolean) => void;
}) {
  const header = group.header;
  const contentId = `tree-branch-${session.id}-${group.id}`;
  return (
    <section className={header ? 'tree-outline-branch' : 'tree-outline-root'}>
      {header && (
        <button
          type="button"
          className="tree-path-toggle"
          aria-expanded={header.expanded}
          aria-controls={contentId}
          disabled={searching}
          data-active={!header.expanded && header.active}
          title={header.title}
          onClick={() => onToggle(group.id, !header.expanded)}
        >
          {header.expanded ? (
            <ChevronDown size={13} aria-hidden="true" />
          ) : (
            <ChevronRight size={13} aria-hidden="true" />
          )}
          <span>{header.title}</span>
          <small>
            {header.count} {showAll ? 'entries' : 'messages'}
            {header.active && <span className="tree-active"> · active</span>}
            {header.selected && <span> · preview</span>}
          </small>
        </button>
      )}
      <div
        id={contentId}
        className={header ? 'tree-outline-branch-content' : undefined}
        hidden={header?.expanded === false}
      >
        {group.messages.map((row) => (
          <Link
            key={row.id}
            to="/app/projects/$projectId/sessions/$sessionId"
            params={{ projectId: session.projectId, sessionId: session.id }}
            search={{ branch: row.entryId }}
            onClick={(event) => {
              if (row.entryId) {
                requestBranchSelection(
                  event,
                  session.id,
                  session.projectId,
                  row.entryId,
                  live.getState(),
                );
              }
            }}
            className={`tree-entry ${row.selected ? 'selected' : ''} ${row.context ? 'tree-context' : ''}`}
            data-role={row.kind}
            data-active={row.active}
            title={`${row.kind}: ${row.title}`}
            aria-current={row.selected ? 'page' : undefined}
          >
            <div className="tree-entry-meta">
              <span>
                {row.kind === 'user'
                  ? 'You'
                  : row.kind === 'assistant'
                    ? 'Assistant'
                    : row.kind.replaceAll('_', ' ')}
              </span>
              {row.active && (
                <span className="tree-active">{row.exactActive ? 'active' : 'active path'}</span>
              )}
            </div>
            <p>{row.title}</p>
          </Link>
        ))}
        {group.children.length > 0 && (
          <div className="tree-outline-forks">
            {group.children.map((child) => (
              <TreeOutlineGroup
                key={child.id}
                group={child}
                session={session}
                showAll={showAll}
                searching={searching}
                onToggle={onToggle}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function SessionTree({
  session,
  online,
  open,
  onOpenChange,
  wide,
  onWideChange,
}: {
  session: Session;
  online: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wide: boolean;
  onWideChange: (wide: boolean) => void;
}) {
  const query = useQuery(sessionTreeQuery(session.id, 'details'));
  const selection = useSearch({ strict: false });
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [paths, setPaths] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const entries = useRef<HTMLElement>(null);
  const connected =
    online &&
    session.connection === 'connected' &&
    query.data?.connected === true &&
    query.data.generation === session.generation;
  const branchCount = useMemo(
    () => (query.data ? conversationBranchCount(query.data) : null),
    [query.data],
  );
  const graph = useMemo(
    () =>
      sessionGraph(
        query.data
          ? { ...query.data, connected }
          : {
              sessionId: session.id,
              generation: session.generation,
              connected: false,
              activeLeafId: null,
              nodes: [],
            },
        {
          showAll,
          search,
          selectedId: selection.branch,
          paths,
        },
      ),
    [
      query.data,
      connected,
      session.id,
      session.generation,
      showAll,
      search,
      selection.branch,
      paths,
    ],
  );
  const activeRow = (
    graph.rows.find((row) => row.type === 'message' && row.active) ??
    graph.rows.find((row) => row.active && !row.expanded)
  )?.id;
  useEffect(() => {
    if (!open) {
      return;
    }
    input.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open, onOpenChange]);
  useEffect(() => {
    if (!open || search || !activeRow) {
      return;
    }
    const container = entries.current;
    const active = container?.querySelector<HTMLElement>('[data-active="true"]');
    if (container && active) {
      container.scrollTop +=
        active.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        active.clientHeight / 2 -
        container.clientHeight / 2;
    }
  }, [open, search, activeRow]);
  return (
    <>
      <Button
        ref={trigger}
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-controls={`tree-${session.id}`}
        onClick={() => onOpenChange(!open)}
      >
        <GitBranch aria-hidden="true" />
        Tree
        {branchCount !== null
          ? ` · ${branchCount} ${branchCount === 1 ? 'branch' : 'branches'}`
          : ''}
      </Button>
      {open &&
        createPortal(
          <aside
            className={`tree-panel ${wide ? 'tree-wide' : ''}`}
            id={`tree-${session.id}`}
            aria-label="Session tree"
          >
            <div className="tree-panel-heading">
              <h2>
                <GitBranch size={16} aria-hidden="true" />
                Session tree
              </h2>
              <div className="controls">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={wide ? 'Narrow tree panel' : 'Widen tree panel'}
                  title={wide ? 'Narrow panel' : 'Widen panel'}
                  onClick={() => onWideChange(!wide)}
                >
                  {wide ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Close session tree"
                  onClick={() => {
                    onOpenChange(false);
                    trigger.current?.focus();
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            </div>
            <div className="tree-panel-filters">
              <label className="tree-search">
                <Search size={14} aria-hidden="true" />
                <input
                  ref={input}
                  type="search"
                  aria-label="Search session tree"
                  placeholder="Search messages…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label className="tree-show-all">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(event) => setShowAll(event.target.checked)}
                />
                Show all entries
              </label>
              <p className="muted">
                {branchCount ?? '…'} {branchCount === 1 ? 'branch' : 'branches'} ·{' '}
                {graph.messageCount} {showAll ? 'entries' : 'messages'} · Select to switch when
                idle, otherwise preview.
              </p>
              {search.trim() && (
                <p className="muted">
                  Matching entries and their ancestors. Collapses are ignored while searching.
                </p>
              )}
              {!connected && <p className="muted">Saved tree. Active position unknown.</p>}
              {connected && query.data?.activeLeafId === null && (
                <p className="muted">Active position: before the first message.</p>
              )}
            </div>
            {query.isPending && <p className="tree-panel-notice muted">Loading session tree…</p>}
            {query.error && (
              <div className="tree-panel-notice error" role="status">
                <p>{query.error.message}</p>
                <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>
                  Retry
                </Button>
              </div>
            )}
            <nav ref={entries} className="tree-panel-entries" aria-label="Saved conversation paths">
              <div className={graph.groups.length > 1 ? 'tree-outline-forks' : 'tree-outline'}>
                {graph.groups.map((group) => (
                  <TreeOutlineGroup
                    key={group.id}
                    group={group}
                    session={session}
                    showAll={showAll}
                    searching={Boolean(search.trim())}
                    onToggle={(id, expanded) =>
                      setPaths((current) => new Map(current).set(id, expanded))
                    }
                  />
                ))}
              </div>
              {query.data && graph.rows.length === 0 && (
                <p className="tree-panel-notice muted">
                  {search
                    ? 'No matching entries.'
                    : showAll
                      ? 'No saved entries yet.'
                      : 'No conversation messages. Enable Show all entries to inspect metadata.'}
                </p>
              )}
            </nav>
          </aside>,
          document.body,
        )}
    </>
  );
}
