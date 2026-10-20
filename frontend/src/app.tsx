import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, Outlet, useParams } from '@tanstack/react-router';
import { ArrowUp, Folder, Power, RefreshCw, Square, Terminal } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ImageAttachment } from '../../src/attachments';
import { record } from '../../src/client-state';
import { ApiError, operate, projects, sessions } from './api';
import { live, queryClient } from './client';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Textarea } from './components/ui/textarea';
import { ImageAttachments } from './image-attachments';
import { LaunchSession } from './launch-session';
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
            <span className="brand-mark">
              <Terminal size={17} aria-hidden="true" />
            </span>
            pim<span>native Pi relay</span>
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
        <LaunchSession />
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
                  <Badge variant="outline" className="px-1 py-0 text-[10px] font-normal">
                    {session.connection === 'connected' ? 'live' : 'read-only'}
                  </Badge>
                </small>
                <small>
                  <time dateTime={updatedAt}>{new Date(updatedAt).toLocaleString()}</time>
                </small>
              </Link>
            );
          })}
          {sortedSessions.length > 15 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 w-full"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? 'Show recent only' : 'Show older sessions'}
            </Button>
          )}
        </nav>
        <footer className="flex items-center gap-2">
          <Folder size={13} aria-hidden="true" />
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
      <div className="welcome-mark">
        <Terminal size={24} aria-hidden="true" />
      </div>
      <p className="eyebrow">PIM / WORKSPACE</p>
      <h1>
        Your sessions,
        <br />
        on your PC.
      </h1>
      <p>Create a session, resume saved history, or connect a running native Pi instance.</p>
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
  submittedImages?: ImageAttachment[];
}

function SessionPane({ id, projectId }: { id: string; projectId: string }) {
  const connection = useSyncExternalStore(live.subscribe, live.getState);
  const projectQuery = useQuery({ queryKey: ['projects'], queryFn: projects });
  const projectName =
    projectQuery.data?.find((project) => project.id === projectId)?.name ?? 'Project';
  const [draft, setDraft] = useState(() => sessionStorage.getItem(`draft:${id}`) ?? '');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [readingImages, setReadingImages] = useState(false);
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
        variables.command.type === 'stop_runtime'
          ? 'Shutdown requested. Runtime exit is not yet confirmed.'
          : `${disposition ? String(disposition) : String(result.outcome)}. Not necessarily finished.`,
      );
      if (variables.submitted !== undefined && draft === variables.submitted) {
        setDraft('');
      }
      if (variables.submittedImages) {
        setAttachments((current) => (current === variables.submittedImages ? [] : current));
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
          {session?.connection === 'connected' && snapshot?.state.managedRuntime === true && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!active}
              onClick={() => {
                if (
                  window.confirm(
                    'Stop this Pi runtime? Active work will be interrupted and queued messages will not be resumed. Saved history will remain. This also closes its terminal.',
                  )
                ) {
                  mutation.mutate({ command: { type: 'stop_runtime' } });
                }
              }}
            >
              <Power aria-hidden="true" />
              Stop runtime
            </Button>
          )}
          {session?.connection === 'disconnected' && session.projectId === projectId && (
            <LaunchSession projectId={projectId} resumeId={id} />
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={live.refresh}
            disabled={connection.status === 'offline' || mutation.isPending}
          >
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
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
          Connected to native Pi. Prompts run in its terminal process. Model and thinking changes
          require idle Pi with no queued messages or dialogs. Queue editing and dialog answers
          remain terminal-only.
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
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={connection.status !== 'ready'}
            onClick={() => {
              setUncertain(false);
              sessionStorage.removeItem(`uncertain:${id}`);
              mutation.reset();
            }}
          >
            I reviewed the session
          </Button>
        </div>
      )}
      {snapshot && <Transcript view={snapshot.view} />}
      <div className="composer">
        {snapshot && (
          <SessionSettings
            controls={snapshot.controls}
            disabled={
              !active ||
              snapshot.view.running ||
              snapshot.view.compacting ||
              snapshot.state.isStreaming === true ||
              snapshot.state.hasPendingMessages === true ||
              snapshot.state.pendingDialog != null
            }
            onCommand={(command) => mutation.mutate({ command })}
          />
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (
              active &&
              !readingImages &&
              (draft.trim() || attachments.length) &&
              !(mode === 'prompt' && snapshot?.view.running)
            ) {
              mutation.mutate({
                command: { type: mode, message: draft.trim() ? draft : '', images: attachments },
                submitted: draft,
                submittedImages: attachments,
              });
            }
          }}
        >
          <ImageAttachments
            images={attachments}
            onChange={setAttachments}
            disabled={mutation.isPending || uncertain}
            onBusy={setReadingImages}
          >
            <Textarea
              aria-label="Message"
              placeholder={
                session?.connection === 'connected'
                  ? 'What should Pi work on?'
                  : 'Connect native Pi to send a message'
              }
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.nativeEvent.isComposing ||
                  event.repeat ||
                  event.ctrlKey ||
                  event.metaKey ||
                  event.shiftKey
                ) {
                  return;
                }
                if (event.key === 'Enter' && event.altKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                } else if (event.key === 'Escape' && !event.altKey && active) {
                  event.preventDefault();
                  mutation.mutate({ command: { type: 'abort' } });
                }
              }}
              rows={4}
            />
          </ImageAttachments>
          <div className="composer-footer">
            <label>
              Send as{' '}
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:ring-1 focus-visible:ring-ring"
                value={mode}
                onChange={(event) => setMode(event.target.value as typeof mode)}
              >
                <option value="prompt">Prompt</option>
                <option value="steer">Steer</option>
                <option value="follow_up">Follow-up</option>
              </select>
            </label>
            <span className="muted" role="status">
              {mutation.isPending ? 'Submitting…' : outcome ? outcome : 'Draft stays in this tab.'}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-red-300 hover:text-red-200"
              disabled={!active}
              onClick={() => mutation.mutate({ command: { type: 'abort' } })}
              aria-keyshortcuts="Escape"
              title="Abort (Esc in message box). Does not clear queued messages"
            >
              <Square aria-hidden="true" />
              Abort
            </Button>
            <Button
              type="submit"
              size="sm"
              aria-keyshortcuts="Alt+Enter"
              title="Send (Alt+Enter in message box)"
              disabled={
                !active ||
                readingImages ||
                (!draft.trim() && !attachments.length) ||
                (mode === 'prompt' && snapshot?.view.running)
              }
            >
              <ArrowUp aria-hidden="true" />
              Send
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
