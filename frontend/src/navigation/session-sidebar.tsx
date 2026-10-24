import { Link } from '@tanstack/react-router';
import {
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Folder,
  MessageCircleQuestion,
  Pin,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  activityCounts,
  groupSessions,
  type SessionFilter,
  visibleSessions,
} from '../../../src/client/inventory';
import { relativeTime } from '../../../src/client/relative-time';
import { hasUnreadCompletion } from '../../../src/shared/session-read-state';
import type { InventorySession, Project } from '../../../src/shared/sessions';
import { relayServer } from '../client/connection';
import { Button } from '../components/ui/button';
import { type WindowedItem, WindowedList } from '../components/windowed-list';
import { SessionBranches, SessionBranchToggle } from '../session/branches/session-branches';
import { ArchiveSession } from './archive-session';
import { LaunchSession } from './launch-session';
import { statuses } from './session-status';
import { projectColor, visibleProjects } from './sidebar-state';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const SessionRow = memo(function SessionRow({
  session,
  parent,
  selected,
  online,
  open,
  now,
  onToggle,
}: {
  session: InventorySession;
  parent?: InventorySession;
  selected: boolean;
  online: boolean;
  open: boolean;
  now: number;
  onToggle: (id: string) => void;
}) {
  const status = statuses[session.activity];
  const isUnread = hasUnreadCompletion(session.readState);
  const hasCompletion = session.readState.completionId !== null;
  const Icon =
    session.activity === 'idle' && hasCompletion
      ? isUnread
        ? CheckCircle2
        : CheckCheck
      : status.icon;
  const updatedAt = session.updatedAt ?? session.createdAt;
  const date = new Date(updatedAt);
  const dateTitle = Number.isFinite(date.getTime()) ? dateFormat.format(date) : updatedAt;
  const title = session.title || 'Untitled session';
  return (
    <div
      className={`session-item ${selected ? 'selected' : ''} activity-${session.activity} ${isUnread ? 'unread' : ''}`}
    >
      <div className="session-row">
        <SessionBranchToggle
          session={session}
          online={online}
          open={open}
          onToggle={() => onToggle(session.id)}
        />
        <Link
          to="/app/projects/$projectId/sessions/$sessionId"
          params={{ projectId: session.projectId, sessionId: session.id }}
          className={`session-link activity-${session.activity} ${hasCompletion ? 'has-completion' : ''} ${isUnread ? 'unread' : ''} ${selected ? 'selected' : ''}`}
          aria-current={selected ? 'page' : undefined}
          title={`${title}\n${status.description}${session.parentSession ? `\nFrom ${parent?.title || 'another session'}` : ''}`}
        >
          <Icon
            className={`session-status-icon ${session.activity === 'running' ? 'working-icon' : ''}`}
            size={16}
            aria-hidden="true"
          />
          <div className="session-summary">
            <span className="session-title">{title}</span>
            <span className="sr-only">{status.description}</span>
            {isUnread && <span className="sr-only">Unviewed turn</span>}
          </div>
        </Link>
        <div className="session-trailing">
          <time className="session-time" dateTime={updatedAt} title={dateTitle}>
            {relativeTime(updatedAt, now)}
          </time>
          <ArchiveSession session={session} online={online} />
        </div>
      </div>
      {open && <SessionBranches session={session} selected={selected} online={online} />}
    </div>
  );
});

const ProjectHeader = memo(function ProjectHeader({
  group,
  closed,
  pinned,
  onToggle,
  onPin,
}: {
  group: ReturnType<typeof groupSessions>[number];
  closed: boolean;
  pinned: boolean;
  onToggle: (id: string) => void;
  onPin: (id: string) => void;
}) {
  const { project, configured, sessions } = group;
  const counts = activityCounts(sessions);
  return (
    <section className="project-group" data-project-id={project.id}>
      <div className="project-header">
        <button
          type="button"
          className="project-toggle"
          aria-expanded={!closed}
          title={`${project.directory}\n${sessions.length} sessions${counts.running ? `, ${counts.running} running` : ''}`}
          onClick={() => onToggle(project.id)}
        >
          <Folder size={17} style={{ color: projectColor(project.id) }} aria-hidden="true" />
          <span className="project-name">{project.name}</span>
          {counts.blocked > 0 && (
            <span
              className="project-attention status-blocked"
              title={`${counts.blocked} need input`}
            >
              <MessageCircleQuestion size={12} aria-hidden="true" />
              <span className="sr-only">{counts.blocked} need input</span>
            </span>
          )}
          <ChevronDown
            size={13}
            className={closed ? 'project-chevron closed' : 'project-chevron'}
            aria-hidden="true"
          />
        </button>
        <div className="project-actions">
          <button
            type="button"
            className="project-pin"
            aria-label={`${pinned ? 'Unpin' : 'Pin'} project ${project.name}`}
            aria-pressed={pinned}
            onClick={() => onPin(project.id)}
          >
            <Pin size={12} aria-hidden="true" />
          </button>
          {configured && <LaunchSession projectId={project.id} compact />}
        </div>
      </div>
      {sessions.length === 0 && !closed && <p className="project-empty">No sessions yet</p>}
    </section>
  );
});

export const SessionSidebar = memo(function SessionSidebar({
  projects,
  sessions,
  filtered,
  selectedId,
  online,
  filter,
  search,
}: {
  projects: Project[];
  sessions: InventorySession[];
  filtered: InventorySession[];
  selectedId?: string;
  online: boolean;
  filter: SessionFilter;
  search: string;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [branches, setBranches] = useState<Set<string>>(() => new Set());
  const pinKey = `lpi:sidebar:${relayServer ?? window.location.origin}:pins`;
  const [pinned, setPinned] = useState<Set<string>>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(pinKey) ?? '[]');
      if (Array.isArray(value) && value.every((id) => typeof id === 'string')) {
        return new Set(value);
      }
    } catch {
      // Project pinning is optional; unavailable storage must not prevent browsing.
    }
    return new Set();
  });
  const [now, setNow] = useState(Date.now);
  const groups = useMemo(
    () => groupSessions(projects, filtered, online, filter === 'archived'),
    [projects, filtered, online, filter],
  );
  const searching = search.trim().length > 0;
  const byFile = useMemo(
    () => new Map(sessions.map((session) => [session.file, session])),
    [sessions],
  );
  const shown = useMemo(
    () => visibleProjects(groups, selectedId, pinned, searching || filter !== 'all'),
    [groups, selectedId, pinned, searching, filter],
  );
  const toggleProject = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }, []);
  const togglePin = useCallback((id: string) => {
    setPinned((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }, []);
  const toggleBranch = useCallback((id: string) => {
    setBranches((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(pinKey, JSON.stringify([...pinned]));
    } catch {
      // In-memory pins remain usable when browser storage is unavailable.
    }
  }, [pinKey, pinned]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const rows = useMemo(() => {
    const rows: WindowedItem[] = [];
    for (const group of shown) {
      const { project, sessions: items } = group;
      if (items.length === 0 && (searching || filter !== 'all')) {
        continue;
      }
      const closed = !searching && collapsed.has(project.id);
      rows.push({
        key: `project:${project.id}`,
        estimate: items.length === 0 ? 65 : 42,
        content: (
          <ProjectHeader
            group={group}
            closed={closed}
            pinned={pinned.has(project.id)}
            onToggle={toggleProject}
            onPin={togglePin}
          />
        ),
      });
      if (closed) {
        continue;
      }
      const all = expanded.has(project.id);
      const visible = visibleSessions(items, selectedId, all || searching || filter !== 'all');
      for (const session of visible) {
        rows.push({
          key: `session:${session.id}`,
          estimate: 38,
          content: (
            <SessionRow
              session={session}
              parent={session.parentSession ? byFile.get(session.parentSession) : undefined}
              selected={selectedId === session.id}
              online={online}
              open={branches.has(session.id)}
              onToggle={toggleBranch}
              now={now}
            />
          ),
        });
      }
      if (!searching && filter === 'all' && (all || visible.length < items.length)) {
        rows.push({
          key: `more:${project.id}`,
          estimate: 44,
          content: (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="show-project-sessions"
              onClick={() =>
                setExpanded((current) => {
                  const next = new Set(current);
                  if (!next.delete(project.id)) {
                    next.add(project.id);
                  }
                  return next;
                })
              }
            >
              {all ? 'Show less' : `Show ${items.length - visible.length} older`}
            </Button>
          ),
        });
      }
    }
    return rows;
  }, [
    shown,
    searching,
    filter,
    collapsed,
    pinned,
    toggleProject,
    togglePin,
    expanded,
    selectedId,
    byFile,
    online,
    branches,
    toggleBranch,
    now,
  ]);
  if (filtered.length === 0 && (searching || filter !== 'all')) {
    return <p className="project-empty">No matching sessions</p>;
  }
  return <WindowedList items={rows} resetKey={`${search}:${filter}`} />;
});
