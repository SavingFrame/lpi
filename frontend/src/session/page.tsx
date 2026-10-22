import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Power, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ComposerDraft } from '../../../src/client/drafts';
import { ExtensionPanels } from '../../../src/extension-support/web';
import { emptyView } from '../../../src/shared/client-state';
import { previewBranch, projects } from '../api';
import { Welcome } from '../app';
import { launches, live, queryClient } from '../client';
import { ConfirmButton } from '../components/confirm-button';
import { Button } from '../components/ui/button';
import { LaunchSession } from '../launch-session';
import { ReadCompletion } from '../read-completion';
import { Transcript } from '../transcript';
import { branchAction, branchSelections, navigateBranch } from './branch-navigation';
import { Composer } from './composer';
import { SessionTree } from './tree';
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
  const [treeOpen, setTreeOpen] = useState(false);
  const [treeWide, setTreeWide] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState<ComposerDraft | null>(null);
  const [navigationPending, setNavigationPending] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const selectionRequest = useSyncExternalStore(
    branchSelections.subscribe,
    branchSelections.getState,
  );
  const selection = useRef({ branch, active: false });
  useEffect(() => {
    setNavigationPending(false);
    setNavigationError(null);
    const current = { branch, active: true };
    selection.current = current;
    return () => {
      current.active = false;
      queueMicrotask(() => {
        if (
          current.branch &&
          (!selection.current.active || selection.current.branch !== current.branch)
        ) {
          branchSelections.discard(id, current.branch);
        }
      });
    };
  }, [branch, id]);
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
  const selectBranch = useCallback(
    (entryId?: string) => {
      if (entryId) {
        branchSelections.request(
          id,
          entryId,
          branchAction(live.getState(), id, projectId, entryId, commands.available()),
        );
      }
      return navigate({
        to: '/app/projects/$projectId/sessions/$sessionId',
        params: { projectId, sessionId: id },
        search: entryId ? { branch: entryId } : {},
      });
    },
    [id, projectId, commands.available, navigate],
  );
  useEffect(() => {
    if (!branch || selectionRequest?.sessionId !== id || selectionRequest.entryId !== branch) {
      return;
    }
    // Defer consuming click intent until StrictMode effect setup/cleanup has completed.
    queueMicrotask(() => {
      if (!selection.current.active || selection.current.branch !== branch) {
        return;
      }
      const intent = branchSelections.take(id, branch);
      if (!intent) {
        return;
      }
      const selected = selection.current;
      const current = () =>
        selected.active && selected === selection.current && branchSelections.isLatest(intent);
      setNavigationPending(true);
      setNavigationError(null);
      void navigateBranch(intent, projectId, {
        connection: live.getState,
        available: commands.available,
        current,
        preview: (sessionId, entryId) =>
          queryClient.fetchQuery({
            queryKey: ['branch', sessionId, entryId],
            queryFn: ({ signal }) => previewBranch(sessionId, entryId, signal),
            retry: false,
          }),
        submit: commands.submit,
      })
        .then((result) => {
          if (!current() || (result.type !== 'current' && result.type !== 'switched')) {
            return;
          }
          if (result.type === 'switched' && result.draft) {
            setRestoredDraft(result.draft);
          }
          void navigate({
            to: '/app/projects/$projectId/sessions/$sessionId',
            params: { projectId, sessionId: id },
            search: {},
            replace: true,
          });
        })
        .catch((error: unknown) => {
          if (current()) {
            setNavigationError(error instanceof Error ? error.message : String(error));
          }
        })
        .finally(() => {
          if (current()) {
            setNavigationPending(false);
          }
        });
    });
  }, [branch, id, projectId, selectionRequest, commands.available, commands.submit, navigate]);
  return (
    <div
      ref={pane}
      className={`session-pane ${treeOpen ? 'tree-open' : ''} ${treeWide ? 'tree-wide' : ''}`}
    >
      <div className="session-topbar">
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
            {session && (
              <SessionTree
                session={session}
                online={connection.status === 'ready'}
                open={treeOpen}
                onOpenChange={setTreeOpen}
                wide={treeWide}
                onWideChange={setTreeWide}
              />
            )}
            {session?.connection === 'connected' && snapshot?.state.managedRuntime === true && (
              <ConfirmButton
                key={session.generation}
                variant="outline"
                size="sm"
                disabled={!commands.canStop(session.generation)}
                confirmLabel="Stop"
                destructive
                onConfirm={() => void commands.stopRuntime(session.generation)}
              >
                <Power aria-hidden="true" />
                Stop runtime
              </ConfirmButton>
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
                void queryClient.invalidateQueries({ queryKey: ['tree', id] });
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
            below. Queued messages can be inspected and cleared above the composer. Other dialogs
            remain terminal-only.
          </p>
        )}
        {snapshot && snapshot.session.projectId !== projectId && (
          <p className="banner error">This session belongs to a different project.</p>
        )}
        {snapshot?.view.notice && <p className="banner">{snapshot.view.notice}</p>}
      </div>
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
          <span>
            {navigationPending
              ? 'Switching conversation…'
              : 'Read-only branch preview. Select an entry again when Pi is synchronized and idle to switch.'}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => void selectBranch()}>
            Back to current conversation
          </Button>
          {navigationError && <p className="error">{navigationError}</p>}
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
              onPreview={selectBranch}
            />
          )
        : snapshot && <Transcript view={snapshot.view} onPreview={selectBranch} />}
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
        projectId={projectId}
        snapshot={snapshot}
        active={commands.active && !branch}
        previewing={Boolean(branch)}
        restoredDraft={restoredDraft}
        pending={commands.pending}
        uncertain={commands.uncertain}
        outcome={commands.outcome}
        following={following}
        onFollow={follow}
        onNew={async () => {
          const created = await launches.start(projectId);
          if (!created) {
            return false;
          }
          void navigate({
            to: '/app/projects/$projectId/sessions/$sessionId',
            params: { projectId: created.projectId, sessionId: created.id },
          });
          return true;
        }}
        onCommand={commands.submit}
      />
    </div>
  );
}
