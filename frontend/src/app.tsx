import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, Outlet, useParams } from '@tanstack/react-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { record } from '../../src/client-state';
import { ApiError, operate, projects, sessions } from './api';
import { live, queryClient } from './client';
import { SessionSettings } from './session-controls';
import { Transcript } from './transcript';

export function Shell() {
  const { projectId, sessionId } = useParams({ strict: false });
  const projectQuery = useQuery({ queryKey: ['projects'], queryFn: projects });
  const sessionQuery = useQuery({ queryKey: ['sessions'], queryFn: sessions });
  const connection = useSyncExternalStore(live.subscribe, live.getState);
  const [showAll, setShowAll] = useState(false);
  const sortedSessions = [...(sessionQuery.data ?? [])].sort(
    (a, b) => Date.parse(b.updatedAt ?? b.createdAt) - Date.parse(a.updatedAt ?? a.createdAt),
  );
  const visibleSessions = showAll ? sortedSessions : sortedSessions.slice(0, 15);
  const selectedSession = sortedSessions.find((session) => session.id === sessionId);
  if (selectedSession && !visibleSessions.some((session) => session.id === sessionId)) {
    visibleSessions.push(selectedSession);
  }
  useEffect(() => {
    live.connect();
    return live.disconnect;
  }, []);
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Link to="/">
            pim<span> / native Pi relay</span>
          </Link>
        </div>
        <p className={`connection ${connection.status}`} role="status">
          {connection.status}
        </p>
        <p className="local-warning">Local access. No authentication.</p>
        {projectQuery.error && <p className="error">{projectQuery.error.message}</p>}
        {sessionQuery.error && <p className="error">{sessionQuery.error.message}</p>}
        {projectQuery.isPending && <p className="muted">Loading projects…</p>}
        {projectQuery.data?.length === 0 && (
          <p className="muted">
            No project folders found. Add a folder under a configured root, then restart the server.
          </p>
        )}
        <nav aria-label="Recent sessions">
          <h2 className="eyebrow">Recent sessions</h2>
          {sessionQuery.isPending && <p className="muted">Loading sessions…</p>}
          {sessionQuery.data?.length === 0 && <p className="muted">No sessions found.</p>}
          {visibleSessions.map((session) => {
            const project = projectQuery.data?.find((project) => project.id === session.projectId);
            const title = session.title || 'Untitled session';
            const updatedAt = session.updatedAt ?? session.createdAt;
            return (
              <Link
                className={`session-link ${sessionId === session.id ? 'selected' : ''}`}
                to="/app/projects/$projectId/sessions/$sessionId"
                params={{ projectId: session.projectId, sessionId: session.id }}
                key={session.id}
                title={title}
                aria-current={sessionId === session.id ? 'page' : undefined}
              >
                <span>{title}</span>
                <small>
                  {project?.name ?? 'Project'} ·{' '}
                  {session.connection === 'connected' ? 'live' : 'read-only'}
                </small>
                <small>
                  <time dateTime={updatedAt}>{new Date(updatedAt).toLocaleString()}</time>
                </small>
              </Link>
            );
          })}
          {sortedSessions.length > 15 && (
            <button type="button" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show recent only' : 'Show older sessions'}
            </button>
          )}
        </nav>
        <footer>
          {projectQuery.data?.find((project) => project.id === projectId)?.name ??
            'Select a project'}
        </footer>
      </aside>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

export function Welcome() {
  useEffect(() => live.select(null), []);
  return (
    <div className="welcome">
      <p className="eyebrow">PIM / WORKSPACE</p>
      <h1>
        Your sessions,
        <br />
        on your PC.
      </h1>
      <p>Choose a saved session or connect a running native Pi instance.</p>
      <p className="muted">Pi runs the agent. Pim relays history, events, and commands.</p>
    </div>
  );
}

export function SessionPage() {
  const { projectId, sessionId } = useParams({ strict: false });
  if (!projectId || !sessionId) {
    return <Welcome />;
  }
  return <SessionPane key={sessionId} id={sessionId} projectId={projectId} />;
}

interface Operation {
  command: Record<string, unknown>;
  submitted?: string;
}

function SessionPane({ id, projectId }: { id: string; projectId: string }) {
  const connection = useSyncExternalStore(live.subscribe, live.getState);
  const projectQuery = useQuery({ queryKey: ['projects'], queryFn: projects });
  const projectName =
    projectQuery.data?.find((project) => project.id === projectId)?.name ?? 'Project';
  const [draft, setDraft] = useState(() => sessionStorage.getItem(`draft:${id}`) ?? '');
  const [mode, setMode] = useState<'prompt' | 'steer' | 'follow_up'>('prompt');
  const [uncertain, setUncertain] = useState(
    () => sessionStorage.getItem(`uncertain:${id}`) === 'true',
  );
  const [outcome, setOutcome] = useState<string | null>(null);
  useEffect(() => {
    live.select(id);
    return () => live.select(null);
  }, [id]);
  useEffect(() => sessionStorage.setItem(`draft:${id}`, draft), [draft, id]);
  const snapshot = connection.snapshot?.session.id === id ? connection.snapshot : null;
  const session = snapshot?.session;
  const mutation = useMutation({
    mutationFn: (operation: Operation) => {
      if (session?.connection !== 'connected' || connection.status !== 'ready' || uncertain) {
        throw new ApiError('Session is not ready for commands', 'rejected');
      }
      // A reload or route change while awaiting acceptance must also require inspection.
      sessionStorage.setItem(`uncertain:${id}`, 'true');
      return operate(id, session.generation, operation.command);
    },
    onSuccess: (result, variables) => {
      sessionStorage.removeItem(`uncertain:${id}`);
      const disposition =
        result.data === null || result.data === undefined ? null : record(result.data).disposition;
      setOutcome(
        `${disposition ? String(disposition) : String(result.outcome)}. Not necessarily finished.`,
      );
      if (variables.submitted !== undefined && draft === variables.submitted) {
        setDraft('');
      }
      live.refresh();
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.outcome === 'unknown') {
        setUncertain(true);
        sessionStorage.setItem(`uncertain:${id}`, 'true');
      } else {
        sessionStorage.removeItem(`uncertain:${id}`);
      }
      setOutcome(null);
      live.refresh();
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  const active =
    connection.status === 'ready' &&
    !mutation.isPending &&
    !uncertain &&
    session?.projectId === projectId &&
    session.connection === 'connected';
  return (
    <div className="session-pane">
      <header className="session-header">
        <div>
          <p className="eyebrow">
            {projectName} / {id.slice(0, 8)}
          </p>
          <h1>
            {typeof snapshot?.state.sessionName === 'string'
              ? snapshot.state.sessionName
              : 'Pi session'}
          </h1>
          <p className="muted">
            {session?.connection ?? 'Loading'}
            {snapshot?.view.compacting
              ? ' · compacting'
              : snapshot?.view.running
                ? ' · running'
                : session?.connection === 'connected'
                  ? ' · idle'
                  : ''}
          </p>
        </div>
        <div className="controls">
          <button
            type="button"
            onClick={live.refresh}
            disabled={connection.status === 'offline' || mutation.isPending}
          >
            Refresh
          </button>
        </div>
      </header>
      {connection.status !== 'ready' && (
        <p className="banner" role="status">
          {connection.status === 'offline'
            ? 'Disconnected. Pi may still be running.'
            : 'Synchronizing session state…'}{' '}
          {connection.error}
        </p>
      )}
      {session?.connection === 'connected' && (
        <p className="banner">
          Connected to native Pi. Prompts run in its terminal process. Model changes, queue editing,
          and dialog answers remain terminal-only.
        </p>
      )}
      {session?.connection === 'connected' && snapshot?.state.hasPendingMessages === true && (
        <p className="banner">
          Native Pi has queued messages. Inspect or edit the queue in its terminal.
        </p>
      )}
      {snapshot && snapshot.session.projectId !== projectId && (
        <p className="banner error">This session belongs to a different project.</p>
      )}
      {snapshot?.view.notice && <p className="banner">{snapshot.view.notice}</p>}
      {mutation.error && (
        <p className="banner error" role="alert">
          {mutation.error.message}
        </p>
      )}
      {uncertain && (
        <div className="banner error">
          <p>Do not resend automatically. Refresh and inspect the session first.</p>
          <button
            type="button"
            disabled={connection.status !== 'ready'}
            onClick={() => {
              setUncertain(false);
              sessionStorage.removeItem(`uncertain:${id}`);
              mutation.reset();
            }}
          >
            I reviewed the session
          </button>
        </div>
      )}
      {snapshot && <Transcript view={snapshot.view} />}
      <div className="composer">
        {snapshot && <SessionSettings controls={snapshot.controls} />}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (active && draft.trim()) {
              mutation.mutate({ command: { type: mode, message: draft }, submitted: draft });
            }
          }}
        >
          <textarea
            aria-label="Message"
            placeholder={
              session?.connection === 'connected'
                ? 'What should Pi work on?'
                : 'Connect native Pi to send a message'
            }
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
          />
          <div className="composer-footer">
            <label>
              Send as{' '}
              <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
                <option value="prompt">Prompt</option>
                <option value="steer">Steer</option>
                <option value="follow_up">Follow-up</option>
              </select>
            </label>
            <span className="muted" role="status">
              {mutation.isPending ? 'Submitting…' : outcome ? outcome : 'Draft stays in this tab.'}
            </span>
            <button
              type="button"
              className="danger"
              disabled={!active}
              onClick={() => mutation.mutate({ command: { type: 'abort' } })}
              title="Abort does not clear queued messages"
            >
              Abort
            </button>
            <button
              type="submit"
              className="primary"
              disabled={!active || !draft.trim() || (mode === 'prompt' && snapshot?.view.running)}
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
