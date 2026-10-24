import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ArrowDown, Power, RefreshCw, Search } from 'lucide-react';
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ExtensionPanels } from '../../../src/extension-support/web';
import { emptyView } from '../../../src/shared/client-state';
import { promptTitle } from '../../../src/shared/sessions';
import { Welcome } from '../app/welcome';
import { projects, sessions } from '../client/api';
import { launches, live, queryClient } from '../client/controllers';
import { Button } from '../components/ui/button';
import { LaunchSession } from '../navigation/launch-session';
import { SessionTree } from './branches/tree';
import { useBranchNavigation } from './branches/use-branch-navigation';
import { Composer } from './composer/composer';
import { CopySessionValue } from './copy-session-value';
import { ReadCompletion } from './read-completion';
import { useChatScroll } from './scroll/use-chat-scroll';
import { ChatSearch } from './transcript/chat-search';
import { Transcript } from './transcript/transcript';
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
  const [searchOpen, setSearchOpen] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const [treeWide, setTreeWide] = useState(false);
  const connection = useSyncExternalStore(live.subscribe, live.getState);
  const snapshot = connection.snapshot?.session.id === id ? connection.snapshot : null;
  const { pane, viewport, following, follow, pause } = useChatScroll(id, Boolean(snapshot));
  const projectQuery = useQuery({ queryKey: ['projects'], queryFn: projects });
  const projectName =
    projectQuery.data?.find((project) => project.id === projectId)?.name ??
    connection.snapshot?.session.directory ??
    'Project';
  const commands = useSessionCommands(id, projectId);
  useLayoutEffect(() => {
    live.select(id);
    return () => live.select(null);
  }, [id]);
  const inventory = useQuery({ queryKey: ['sessions'], queryFn: sessions });
  const session = snapshot?.session ?? inventory.data?.find((session) => session.id === id);
  const title =
    promptTitle(snapshot?.state.sessionName) ??
    promptTitle(session?.title) ??
    promptTitle(snapshot?.view.messages.find((message) => message.role === 'user')?.content) ??
    'Untitled session';
  const tmuxCommand = session?.tmuxSession
    ? `tmux -L lpi attach-session -t '=${session.tmuxSession}'`
    : undefined;
  const { preview, selectBranch, restoredDraft, navigationPending, navigationError } =
    useBranchNavigation(id, projectId, branch, commands);
  return (
    <div className={`session-pane ${treeOpen ? 'tree-open' : ''} ${treeWide ? 'tree-wide' : ''}`}>
      <div className="session-topbar">
        <header className="session-header">
          <div className="session-heading">
            <div className="session-metadata eyebrow">
              <span>{projectName} /</span>
              {session?.tmuxSession && tmuxCommand ? (
                <>
                  <code title={tmuxCommand}>{session.tmuxSession}</code>
                  <CopySessionValue
                    key={tmuxCommand}
                    value={tmuxCommand}
                    label="tmux attach command"
                  />
                  {(session.connection !== 'connected' || connection.status === 'offline') && (
                    <span
                      className="session-target-status"
                      title="The tmux session may no longer exist."
                    >
                      Last known
                    </span>
                  )}
                </>
              ) : (
                <span title="No managed tmux target registered for this session.">
                  {id.slice(0, 8)}
                </span>
              )}
            </div>
            <div className="session-title-row">
              <h1 title={title}>{title}</h1>
            </div>
            <p className="session-header-status muted">
              {session?.connection ?? 'Loading'}
              {snapshot?.view.compacting
                ? ' · compacting'
                : snapshot?.view.running
                  ? ' · running'
                  : session?.connection === 'connected'
                    ? ' · idle'
                    : ''}
              <span role="status">
                {connection.status === 'syncing' && snapshot && !connection.error
                  ? ' · Updating…'
                  : ''}
              </span>
            </p>
          </div>
          <div className="controls">
            <Button
              ref={searchButton}
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen((open) => !open)}
              title="Search current chat (Ctrl/Cmd+F)"
            >
              <Search aria-hidden="true" />
              Search
            </Button>
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!commands.canStop(session.generation)}
                onClick={() => void commands.stopRuntime(session.generation)}
              >
                <Power aria-hidden="true" />
                Stop runtime
              </Button>
            )}
            {session?.connection === 'disconnected' &&
              session.projectId === projectId &&
              projectQuery.data?.some((project) => project.id === projectId) && (
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
        <ChatSearch
          pane={pane}
          viewport={viewport}
          open={searchOpen}
          onOpenChange={setSearchOpen}
          trigger={searchButton}
          onNavigate={pause}
        />
        {connection.status !== 'ready' &&
          (connection.status !== 'syncing' || !snapshot || connection.error) && (
            <p className="banner" role="status">
              {connection.status === 'offline'
                ? 'Disconnected. Pi may still be running.'
                : 'Synchronizing session state…'}{' '}
              {connection.error}
            </p>
          )}
        {snapshot && snapshot.session.projectId !== projectId && (
          <p className="banner error">This session belongs to a different project.</p>
        )}
        {snapshot?.view.notice && <p className="banner">{snapshot.view.notice}</p>}
      </div>
      <div className="session-history">
        <section
          ref={viewport}
          className="session-scroll"
          data-chat-scroll
          tabIndex={-1}
          aria-label="Conversation history"
        >
          <div ref={pane} className="session-content">
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
              viewport={viewport}
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
          </div>
        </section>
        {!following && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="session-follow rounded-full shadow-lg"
            aria-label="Go to bottom"
            title="Go to bottom"
            onClick={follow}
          >
            <ArrowDown aria-hidden="true" />
          </Button>
        )}
      </div>
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
