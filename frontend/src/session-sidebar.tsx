import { Link } from '@tanstack/react-router';
import {
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Circle,
  Folder,
  GitFork,
  LoaderCircle,
  LockKeyhole,
  MessageCircleQuestion,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  activityCounts,
  filterSessions,
  groupSessions,
  type SessionFilter,
  visibleSessions,
} from '../../src/client/inventory';
import { relativeTime } from '../../src/client/relative-time';
import type { SessionActivity } from '../../src/shared/session-activity';
import { hasUnreadCompletion } from '../../src/shared/session-read-state';
import type { InventorySession, Project } from '../../src/shared/sessions';
import { ArchiveSession } from './archive-session';
import { Button } from './components/ui/button';
import { LaunchSession } from './launch-session';
import { SessionBranches, SessionBranchToggle } from './session-branches';
import { projectColor } from './sidebar-state';

const statuses = {
  running: { label: 'Running', icon: LoaderCircle, description: 'Pi is working or compacting.' },
  blocked: {
    label: 'Needs input',
    icon: MessageCircleQuestion,
    description: 'Pi is waiting for input in the browser or terminal.',
  },
  idle: { label: 'Idle', icon: Circle, description: 'Connected and waiting for work.' },
  unknown: {
    label: 'Saved',
    icon: LockKeyhole,
    description: 'Read-only. Live activity is unavailable; Pi may still be running.',
  },
} satisfies Record<SessionActivity, { label: string; icon: typeof Circle; description: string }>;

export function SessionSidebar({
  projects,
  sessions,
  selectedId,
  online,
  filter,
  search,
}: {
  projects: Project[];
  sessions: InventorySession[];
  selectedId?: string;
  online: boolean;
  filter: SessionFilter;
  search: string;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [branches, setBranches] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(Date.now);
  const filtered = filterSessions(sessions, projects, filter, search, online);
  const groups = groupSessions(projects, filtered, online, filter === 'archived');
  const searching = search.trim().length > 0;
  const byFile = new Map(sessions.map((session) => [session.file, session]));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (filtered.length === 0 && (searching || filter !== 'all')) {
    return <p className="project-empty">No matching sessions</p>;
  }
  return groups.map(({ project, configured, sessions: items }) => {
    const counts = activityCounts(items);
    const unread = items.filter((session) => hasUnreadCompletion(session.readState)).length;
    if (items.length === 0 && (searching || filter !== 'all')) {
      return null;
    }
    const closed = !searching && collapsed.has(project.id);
    const all = expanded.has(project.id);
    const visible = visibleSessions(items, selectedId, all || searching || filter !== 'all');
    return (
      <section className="project-group" key={project.id}>
        <div className="project-header">
          <button
            type="button"
            className="project-toggle"
            aria-expanded={!closed}
            aria-controls={`project-${project.id}`}
            title={project.directory}
            onClick={() =>
              setCollapsed((current) => {
                const next = new Set(current);
                if (next.has(project.id)) {
                  next.delete(project.id);
                } else {
                  next.add(project.id);
                }
                return next;
              })
            }
          >
            <ChevronDown
              size={13}
              className={closed ? 'project-chevron closed' : 'project-chevron'}
              aria-hidden="true"
            />
            <Folder size={17} style={{ color: projectColor(project.id) }} aria-hidden="true" />
            <span className="project-name">{project.name}</span>
            <span className="project-count">{items.length}</span>
          </button>
          {configured && <LaunchSession projectId={project.id} compact />}
        </div>
        <div className="project-status">
          {counts.blocked > 0 && (
            <span className="status-blocked">
              <MessageCircleQuestion size={12} aria-hidden="true" />
              {counts.blocked} need input
            </span>
          )}
          {counts.running > 0 && (
            <span className="status-running">
              <LoaderCircle size={12} aria-hidden="true" />
              {counts.running} running
            </span>
          )}
          {unread > 0 && (
            <span className="status-unread">
              <CheckCircle2 size={12} aria-hidden="true" />
              {unread} unviewed
            </span>
          )}
        </div>
        <div id={`project-${project.id}`} hidden={closed}>
          {items.length === 0 && <p className="project-empty">{'No sessions yet'}</p>}
          {visible.map((session) => {
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
            const title = session.title || 'Untitled session';
            const parent = session.parentSession ? byFile.get(session.parentSession) : undefined;
            const open = branches.has(session.id);
            return (
              <div
                key={session.id}
                className={`session-item ${selectedId === session.id ? 'selected' : ''} activity-${session.activity} ${isUnread ? 'unread' : ''}`}
              >
                <div className="session-row">
                  <SessionBranchToggle
                    session={session}
                    online={online}
                    open={open}
                    onToggle={() =>
                      setBranches((current) => {
                        const next = new Set(current);
                        if (next.has(session.id)) {
                          next.delete(session.id);
                        } else {
                          next.add(session.id);
                        }
                        return next;
                      })
                    }
                  />
                  <Link
                    to="/app/projects/$projectId/sessions/$sessionId"
                    params={{ projectId: project.id, sessionId: session.id }}
                    className={`session-link activity-${session.activity} ${hasCompletion ? 'has-completion' : ''} ${isUnread ? 'unread' : ''} ${selectedId === session.id ? 'selected' : ''}`}
                    aria-current={selectedId === session.id ? 'page' : undefined}
                    title={title}
                  >
                    <Icon
                      className={`session-status-icon ${session.activity === 'running' ? 'working-icon' : ''}`}
                      size={16}
                      aria-hidden="true"
                    />
                    <div className="session-summary">
                      <span className="session-title">{title}</span>
                      <small>
                        <span
                          title={status.description}
                          className={`session-status status-${session.activity}`}
                        >
                          {status.label}
                        </span>
                        <time dateTime={updatedAt} title={new Date(updatedAt).toLocaleString()}>
                          {relativeTime(updatedAt, now)}
                        </time>
                      </small>
                      {session.parentSession && (
                        <small
                          className="session-origin"
                          title="Separate session derived from another session. Pi also records this for clones and explicitly parented sessions."
                        >
                          <GitFork size={12} aria-hidden="true" />
                          From {parent?.title || 'another session'}
                        </small>
                      )}
                      {isUnread && (
                        <small
                          className="completion-notice"
                          title="An observed turn ended and has not been viewed. This does not imply task success."
                        >
                          <CheckCircle2 size={12} aria-hidden="true" />
                          Unviewed turn
                        </small>
                      )}
                    </div>
                  </Link>
                  <ArchiveSession session={session} online={online} />
                </div>
                {open && (
                  <SessionBranches
                    session={session}
                    selected={selectedId === session.id}
                    online={online}
                  />
                )}
              </div>
            );
          })}
          {!searching && filter === 'all' && (all || visible.length < items.length) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="show-project-sessions"
              onClick={() =>
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(project.id)) {
                    next.delete(project.id);
                  } else {
                    next.add(project.id);
                  }
                  return next;
                })
              }
            >
              {all ? 'Show less' : `Show ${items.length - visible.length} older`}
            </Button>
          )}
        </div>
      </section>
    );
  });
}
