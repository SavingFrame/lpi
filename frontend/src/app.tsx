import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { record } from '../../src/client-state';
import { ApiError, create, operate, projects, sessions } from './api';
import { live, queryClient } from './client';
import { SessionSettings } from './session-controls';
import { Transcript } from './transcript';

export function Shell() {
  const { projectId, sessionId } = useParams({ strict: false });
  const projectQuery = useQuery({ queryKey: ['projects'], queryFn: projects });
  const sessionQuery = useQuery({ queryKey: ['sessions'], queryFn: sessions });
  const connection = useSyncExternalStore(live.subscribe, live.getState);
  const navigate = useNavigate();
  useEffect(() => {
    live.connect();
    return live.disconnect;
  }, []);
  const creation = useMutation({
    mutationFn: create,
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void navigate({
        to: '/app/projects/$projectId/sessions/$sessionId',
        params: { projectId: session.projectId, sessionId: session.id },
      });
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Link to="/">
            pim<span> / local agent</span>
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
        <nav aria-label="Projects and sessions">
          {projectQuery.data?.map((project) => (
            <section className="project" key={project.id}>
              <div className="project-heading">
                <Link
                  to="/app/projects/$projectId"
                  params={{ projectId: project.id }}
                  title={project.directory}
                >
                  {project.name}
                </Link>
                <button
                  type="button"
                  className="small"
                  disabled={creation.isPending || connection.status === 'offline'}
                  onClick={() => creation.mutate(project.id)}
                  aria-label={`Create session in ${project.name}`}
                >
                  New
                </button>
              </div>
              {sessionQuery.data
                ?.filter((session) => session.projectId === project.id)
                .slice()
                .reverse()
                .map((session) => (
                  <Link
                    className={`session-link ${sessionId === session.id ? 'selected' : ''}`}
                    to="/app/projects/$projectId/sessions/$sessionId"
                    params={{ projectId: project.id, sessionId: session.id }}
                    key={session.id}
                  >
                    <span>{(session.piSessionId ?? session.id).slice(0, 8)}</span>
                    <small>
                      {session.source === 'pi' ? 'Pi · read-only' : session.ownership.phase}
                      {session.ownership.interrupted ? ' · interrupted' : ''}
                    </small>
                  </Link>
                ))}
            </section>
          ))}
        </nav>
        {creation.error && (
          <p className="error" role="alert">
            {creation.error.message}
          </p>
        )}
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
      <p>Choose a session or create one from the sidebar.</p>
      <p className="muted">
        One runtime owns each session. Browser disconnects do not release ownership.
      </p>
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
  operation: 'start' | 'stop' | 'commands';
  command?: Record<string, unknown>;
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
  const owner = snapshot?.session.ownership;
  const mutation = useMutation({
    mutationFn: (operation: Operation) => {
      if (!owner || connection.status !== 'ready' || uncertain) {
        throw new ApiError('Session is not ready for commands', 'rejected');
      }
      // A reload or route change while awaiting acceptance must also require inspection.
      sessionStorage.setItem(`uncertain:${id}`, 'true');
      return operate(id, owner.generation, operation.operation, operation.command);
    },
    onSuccess: (result, variables) => {
      sessionStorage.removeItem(`uncertain:${id}`);
      const disposition =
        result.data === null || result.data === undefined ? null : record(result.data).disposition;
      setOutcome(
        variables.command?.type === 'set_model' || variables.command?.type === 'set_thinking_level'
          ? 'Settings updated for the next model request'
          : `${disposition ? String(disposition) : String(result.outcome)}. Not necessarily finished.`,
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
  const ready =
    connection.status === 'ready' &&
    !mutation.isPending &&
    !uncertain &&
    snapshot?.session.projectId === projectId;
  const active = ready && owner?.phase === 'rpc';
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
              : snapshot?.session.source === 'pi'
                ? 'Existing Pi session'
                : 'Conversation'}
          </h1>
          <p className="muted">
            {owner?.phase ?? 'Loading'}
            {snapshot?.view.compacting
              ? ' · compacting'
              : snapshot?.view.running
                ? ' · running'
                : owner?.phase === 'rpc'
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
          {owner?.phase === 'unowned' && (
            <button
              type="button"
              disabled={!ready}
              onClick={() => mutation.mutate({ operation: 'start' })}
            >
              Start runtime
            </button>
          )}
          {owner?.phase === 'rpc' && (
            <button
              type="button"
              className="danger"
              disabled={!ready}
              onClick={() => mutation.mutate({ operation: 'stop' })}
              title="Stop the runtime. This may interrupt active work."
            >
              Stop runtime
            </button>
          )}
        </div>
      </header>
      {connection.status !== 'ready' && (
        <p className="banner" role="status">
          {connection.status === 'offline'
            ? 'Disconnected. The agent may still be running.'
            : 'Synchronizing authoritative session state…'}{' '}
          {connection.error}
        </p>
      )}
      {owner?.phase === 'unknown' && snapshot?.session.source !== 'pi' && (
        <p className="banner error">
          Ownership is unknown. Starting another writer is blocked. Use offline operator recovery.
        </p>
      )}
      {owner?.interrupted && (
        <p className="banner">
          This session has interrupted or uncertain work. History is not an execution checkpoint.
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
        {snapshot && (
          <SessionSettings
            controls={snapshot.controls}
            enabled={Boolean(active)}
            onChange={(command) => mutation.mutate({ operation: 'commands', command })}
          />
        )}
        {snapshot &&
          (snapshot.view.steering.length + snapshot.view.followUp.length > 0 ||
            Number(snapshot.state.pendingMessageCount ?? 0) > 0) && (
            <details className="queues" open>
              <summary>Pending queue</summary>
              <ul>
                {[...new Set(snapshot.view.steering)].map((text) => (
                  <li key={`steer:${text}`}>
                    Steer: {text} (×{snapshot.view.steering.filter((item) => item === text).length})
                  </li>
                ))}
                {[...new Set(snapshot.view.followUp)].map((text) => (
                  <li key={`follow:${text}`}>
                    Follow-up: {text} (×
                    {snapshot.view.followUp.filter((item) => item === text).length})
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={!active}
                onClick={() =>
                  mutation.mutate({ operation: 'commands', command: { type: 'clear_queue' } })
                }
              >
                Clear queue
              </button>
            </details>
          )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (active && draft.trim()) {
              mutation.mutate({
                operation: 'commands',
                command: { type: mode, message: draft },
                submitted: draft,
              });
            }
          }}
        >
          <textarea
            aria-label="Message"
            placeholder={
              owner?.phase === 'unowned'
                ? 'Start the runtime to send a message'
                : 'What should Pi work on?'
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
              onClick={() => mutation.mutate({ operation: 'commands', command: { type: 'abort' } })}
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
