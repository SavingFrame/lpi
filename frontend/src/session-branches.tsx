import { useQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { Circle, GitBranch } from 'lucide-react';
import type { Session } from '../../src/shared/sessions';
import { tree } from './api';
import { branchRows } from './branch-state';
import { Button } from './components/ui/button';

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
  const query = useQuery({
    queryKey: ['tree', session.id],
    queryFn: ({ signal }) => tree(session.id, signal),
    retry: false,
  });
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
  return (
    <section
      className="session-branches"
      id={`branches-${session.id}`}
      aria-label="Session branches"
    >
      {query.isPending && <p className="muted">Loading branches…</p>}
      {query.error && (
        <div className="error" role="status">
          <p>{query.error.message}</p>
          <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      )}
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
