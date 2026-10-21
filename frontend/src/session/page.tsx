import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Power, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ExtensionPanels } from '../../../src/extension-support/web';
import { emptyView } from '../../../src/shared/client-state';
import { previewBranch, projects } from '../api';
import { Welcome } from '../app';
import { draftForBranch } from '../branch-state';
import { live } from '../client';
import { Button } from '../components/ui/button';
import { LaunchSession } from '../launch-session';
import { ReadCompletion } from '../read-completion';
import { Transcript } from '../transcript';
import { Composer } from './composer';
import type { ComposerDraft } from './draft';
import { useChatScroll } from './use-chat-scroll';
import { useSessionCommands } from './use-session-commands';

export function SessionPage() {
  const { projectId, sessionId } = useParams({ strict: false });
  const { branch } = useSearch({ strict: false });
  if (!projectId || !sessionId) {
    return <Welcome />;
  }
  return (
    <SessionPane
      key={`${projectId}:${sessionId}`}
      id={sessionId}
      projectId={projectId}
      branch={branch}
    />
  );
}

function SessionPane({
  id,
  projectId,
  branch,
}: {
  id: string;
  projectId: string;
  branch?: string;
}) {
  const navigate = useNavigate();
  const [restoredDraft, setRestoredDraft] = useState<ComposerDraft | null>(null);
  const selection = useRef({ branch, active: false });
  useEffect(() => {
    const current = { branch, active: true };
    selection.current = current;
    return () => {
      current.active = false;
    };
  }, [branch]);
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
  const preview = useQuery({
    queryKey: ['branch', id, branch],
    queryFn: ({ signal }) => previewBranch(id, branch ?? '', signal),
    enabled: Boolean(branch),
    retry: false,
  });
  const selectBranch = (entryId?: string) =>
    navigate({
      to: '/app/projects/$projectId/sessions/$sessionId',
      params: { projectId, sessionId: id },
      search: entryId ? { branch: entryId } : {},
    });
  let draft: ComposerDraft | null = null;
  let draftError: string | null = null;
  if (preview.data && branch !== snapshot?.state.leafId) {
    try {
      draft = draftForBranch(preview.data);
    } catch {
      draftError =
        'This message has attachments that cannot be restored in the browser. Navigate in native Pi instead.';
    }
  }
  const canNavigate =
    commands.active &&
    snapshot &&
    !snapshot.view.running &&
    !snapshot.view.compacting &&
    snapshot.state.isStreaming !== true &&
    snapshot.state.hasPendingMessages !== true &&
    snapshot.state.pendingDialog == null &&
    (snapshot.state.leafId === null || typeof snapshot.state.leafId === 'string');
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
            onClick={() => {
              live.refresh();
              if (branch) {
                void preview.refetch();
              }
            }}
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
      {branch && (
        <div className="banner branch-preview" role="status">
          <p>
            Branch preview. Native Pi has not moved. Continuing switches the active path for every
            client, without restoring project files or generating a summary.
          </p>
          {draft && (
            <p>
              This resumes before the selected user message and restores its text and images to your
              browser draft.
            </p>
          )}
          {draftError && <p className="error">{draftError}</p>}
          <div className="controls">
            <Button type="button" variant="outline" size="sm" onClick={() => void selectBranch()}>
              Return to current conversation
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canNavigate || !preview.data || Boolean(draftError)}
              onClick={async () => {
                if (!canNavigate || !snapshot || !preview.data) {
                  return;
                }
                if (
                  draft &&
                  !window.confirm(
                    'Continue before this user message? Its text and images will replace your browser draft.',
                  )
                ) {
                  return;
                }
                const selected = selection.current;
                const accepted = await commands.submit({
                  type: 'navigate_tree',
                  targetId: branch,
                  expectedLeafId: snapshot.state.leafId as string | null,
                });
                if (accepted && selected.active && selected === selection.current) {
                  if (draft) {
                    setRestoredDraft(draft);
                  }
                  void selectBranch();
                }
              }}
            >
              Continue here
            </Button>
          </div>
          {!canNavigate && (
            <p>
              Switching requires a synchronized, idle native Pi with no queued messages or dialogs.
            </p>
          )}
        </div>
      )}
      {branch && preview.isPending && <p className="banner">Loading branch preview…</p>}
      {branch && preview.error && (
        <p className="banner error" role="alert">
          {preview.error.message}
        </p>
      )}
      {branch
        ? preview.data && (
            <Transcript
              view={{ ...emptyView(), messages: preview.data.messages }}
              onPreview={(entryId) => void selectBranch(entryId)}
            />
          )
        : snapshot && (
            <Transcript view={snapshot.view} onPreview={(entryId) => void selectBranch(entryId)} />
          )}
      <ReadCompletion
        snapshot={snapshot}
        synchronized={connection.status === 'ready' && !branch}
        following={following}
      />
      {snapshot && !branch && (
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
        active={commands.active && !branch}
        previewing={Boolean(branch)}
        restoredDraft={restoredDraft}
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
