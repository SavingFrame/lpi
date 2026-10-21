import { useQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { ChevronDown, Circle, GitBranch } from 'lucide-react';
import type { Session } from '../../src/shared/sessions';
import { branchRows } from './branch-state';
import { live } from './client';
import { requestBranchSelection } from './session/branch-navigation';
import { sessionTreeQuery } from './tree-query';

function useSessionBranches(session: Session, online: boolean) {
  const query = useQuery(sessionTreeQuery(session.id, 'sidebar'));
  const connected =
    online &&
    session.connection === 'connected' &&
    query.data?.connected === true &&
    query.data.generation === session.generation;
  const rows = query.data
    ? branchRows({
        ...query.data,
        connected,
      })
    : [];
  return { query, connected, rows };
}

export function SessionBranchToggle({
  session,
  online,
  open,
  onToggle,
}: {
  session: Session;
  online: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const { rows } = useSessionBranches(session, online);
  if (rows.length < 2) {
    return <span className="branch-toggle" aria-hidden="true" />;
  }
  return (
    <button
      type="button"
      className="branch-toggle"
      aria-label={`${open ? 'Hide' : 'Show'} branches for ${session.title || 'Untitled session'}`}
      aria-expanded={open}
      aria-controls={`branches-${session.id}`}
      onClick={onToggle}
    >
      <ChevronDown size={12} className={open ? '' : 'closed'} aria-hidden="true" />
    </button>
  );
}

export function SessionBranches({
  session,
  selected,
  online,
}: {
  session: Session;
  selected: boolean;
  online: boolean;
}) {
  const search = useSearch({ strict: false });
  const { query, connected, rows } = useSessionBranches(session, online);
  if (rows.length < 2) {
    return null;
  }
  return (
    <section
      className="session-branches"
      id={`branches-${session.id}`}
      aria-label="Session branches"
    >
      {query.data && (
        <>
          {!connected && <p className="muted">Saved paths. Active position unknown.</p>}
          {connected && query.data.activeLeafId === null && (
            <p className="muted">Active position: before the first message.</p>
          )}
          {rows.map((branch) => (
            <Link
              key={branch.id}
              to="/app/projects/$projectId/sessions/$sessionId"
              params={{ projectId: session.projectId, sessionId: session.id }}
              search={{ branch: branch.id }}
              onClick={(event) =>
                requestBranchSelection(
                  event,
                  session.id,
                  session.projectId,
                  branch.id,
                  live.getState(),
                )
              }
              className={`branch-link ${selected && search.branch === branch.id ? 'selected' : ''}`}
              style={{ paddingLeft: `${8 + Math.min(branch.depth, 6) * 8}px` }}
              title={branch.title}
              aria-current={selected && search.branch === branch.id ? 'page' : undefined}
            >
              {branch.active ? (
                <Circle size={10} fill="currentColor" aria-hidden="true" />
              ) : (
                <GitBranch size={12} aria-hidden="true" />
              )}
              <span>{branch.title}</span>
              {branch.active && <small>active</small>}
            </Link>
          ))}
          {rows.length === 0 && <p className="muted">No saved conversation branches yet.</p>}
        </>
      )}
    </section>
  );
}
