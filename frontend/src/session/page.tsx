import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Power, RefreshCw } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';
import { ExtensionPanels } from '../../../src/extension-support/web';
import { projects } from '../api';
import { Welcome } from '../app';
import { live } from '../client';
import { Button } from '../components/ui/button';
import { LaunchSession } from '../launch-session';
import { ReadCompletion } from '../read-completion';
import { Transcript } from '../transcript';
import { Composer } from './composer';
import { useChatScroll } from './use-chat-scroll';
import { useSessionCommands } from './use-session-commands';

export function SessionPage() {
  const { projectId, sessionId } = useParams({ strict: false });
  if (!projectId || !sessionId) {
    return <Welcome />;
  }
  return <SessionPane key={`${projectId}:${sessionId}`} id={sessionId} projectId={projectId} />;
}

function SessionPane({ id, projectId }: { id: string; projectId: string }) {
  const { pane, following, follow } = useChatScroll();
  const connection = useSyncExternalStore(live.subscribe, live.getState);
  const projectQuery = useQuery({ queryKey: ['projects'], queryFn: projects });
  const projectName =
    projectQuery.data?.find((project) => project.id === projectId)?.name ?? 'Project';
  const commands = useSessionCommands(id, projectId);
  useEffect(() => {
    live.select(id);
    return () => live.select(null);
  }, [id]);
  const snapshot = connection.snapshot?.session.id === id ? connection.snapshot : null;
  const session = snapshot?.session;
  return (
    <div ref={pane} className="session-pane">
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
              disabled={!commands.active}
              onClick={() => {
                if (
                  window.confirm(
                    'Stop this Pi runtime? Active work will be interrupted and queued messages will not be resumed. Saved history will remain. This also closes its terminal.',
                  )
                ) {
                  void commands.submit({ type: 'stop_runtime' });
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
            disabled={connection.status === 'offline' || commands.pending}
          >
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </header>
      {connection.status !== 'ready' &&
        (connection.status !== 'syncing' || !snapshot || connection.error) && (
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
          require idle Pi with no queued messages or dialogs. Supported extension questions appear
          below. Other dialogs and queue editing remain terminal-only.
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
      {commands.error && (
        <p className="banner error" role="alert">
          {commands.error.message}
        </p>
      )}
      {commands.uncertain && (
        <div className="banner error">
          <p>Do not resend automatically. Refresh and inspect the session first.</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={connection.status !== 'ready'}
            onClick={commands.review}
          >
            I reviewed the session
          </Button>
        </div>
      )}
      {snapshot && <Transcript view={snapshot.view} />}
      <ReadCompletion snapshot={snapshot} enabled={connection.status === 'ready' && following} />
      {snapshot && (
        <ExtensionPanels
          key={`${snapshot.session.id}:${snapshot.session.generation}`}
          extensions={snapshot.view.extensions}
          disabled={!commands.active}
          onCommand={commands.submit}
        />
      )}
      <Composer
        id={id}
        snapshot={snapshot}
        active={commands.active}
        pending={commands.pending}
        uncertain={commands.uncertain}
        outcome={commands.outcome}
        following={following}
        onFollow={follow}
        onCommand={commands.submit}
      />
    </div>
  );
}
