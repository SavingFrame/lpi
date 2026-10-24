import { useMatch, useNavigate } from '@tanstack/react-router';
import { FileDiff, PanelLeftClose, PanelRightOpen } from 'lucide-react';
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { desktop } from '../client/platform';
import { WorkspaceTab } from '../components/workspace-tab';
import { useWorkspacePanes, type WorkspacePane } from './workspace-panes';

export interface DiffTab {
  projectId: string;
  file?: string;
}

interface OpenDiffTab extends DiffTab {
  pane: WorkspacePane;
}

export type DiffOpening = 'combined' | 'files';

interface VisibleDiffFile {
  projectId: string;
  file: string;
}

interface DiffFocus extends VisibleDiffFile {
  pane: WorkspacePane;
  request: number;
}

const openingKey = 'lpi:diff-opening:v1';

function sameTab(left: DiffTab, right: DiffTab) {
  return left.projectId === right.projectId && left.file === right.file;
}

interface DiffTabsState {
  tabs: OpenDiffTab[];
  rightTab: OpenDiffTab | undefined;
  canSplit: boolean;
  split: (tab: DiffTab) => void;
  moveToMain: (tab: DiffTab) => void;
  opening: DiffOpening;
  setOpening: (opening: DiffOpening) => void;
  settingsError: string;
  openFile: (projectId: string, file: string) => void;
  focus: DiffFocus | null;
  visibleFiles: Record<WorkspacePane, VisibleDiffFile | null>;
  setVisibleFiles: Dispatch<SetStateAction<Record<WorkspacePane, VisibleDiffFile | null>>>;
  open: (tab: DiffTab) => void;
  close: (tab: DiffTab) => void;
}

const DiffTabsContext = createContext<DiffTabsState | null>(null);

export function DiffTabsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { activePane, setActivePane } = useWorkspacePanes();
  const diffMatch = useMatch({ from: '/app/projects/$projectId/diff', shouldThrow: false });
  const sessionMatch = useMatch({
    from: '/app/projects/$projectId/sessions/$sessionId',
    shouldThrow: false,
  });
  const projectId = diffMatch?.params.projectId;
  const file = diffMatch?.search.file;
  const [tabs, setTabs] = useState<OpenDiffTab[]>([]);
  const [rightSelection, setRightSelection] = useState<DiffTab | null>(null);
  const rightTab =
    tabs.find((tab) => tab.pane === 'right' && rightSelection && sameTab(tab, rightSelection)) ??
    tabs.find((tab) => tab.pane === 'right');
  const [opening, updateOpening] = useState<DiffOpening>(() => {
    try {
      return localStorage.getItem(openingKey) === 'files' ? 'files' : 'combined';
    } catch {
      return 'combined';
    }
  });
  const [settingsError, setSettingsError] = useState('');
  const [focus, setFocus] = useState<DiffFocus | null>(null);
  const [visibleFiles, setVisibleFiles] = useState<Record<WorkspacePane, VisibleDiffFile | null>>({
    main: null,
    right: null,
  });
  const lastSession = useRef<{ projectId: string; sessionId: string; branch?: string } | null>(
    null,
  );
  const canSplit = Boolean(sessionMatch || lastSession.current);
  function setOpening(value: DiffOpening) {
    updateOpening(value);
    try {
      localStorage.setItem(openingKey, value);
      setSettingsError('');
    } catch {
      setSettingsError('Could not save diff preference. It will apply until the app reloads.');
    }
  }
  function place(tab: DiffTab, pane: WorkspacePane) {
    setTabs((current) =>
      current.some((item) => sameTab(item, tab))
        ? current.map((item) => (sameTab(item, tab) ? { ...tab, pane } : item))
        : [...current, { ...tab, pane }],
    );
    if (pane === 'right') {
      setRightSelection(tab);
    }
    setActivePane(pane);
  }
  function navigateMain(tab: DiffTab) {
    void navigate({
      to: '/app/projects/$projectId/diff',
      params: { projectId: tab.projectId },
      search: tab.file ? { file: tab.file } : {},
    });
  }
  function returnToChat() {
    if (lastSession.current) {
      const { branch, ...params } = lastSession.current;
      void navigate({
        to: '/app/projects/$projectId/sessions/$sessionId',
        params,
        search: branch ? { branch } : {},
      });
    } else {
      void navigate({ to: '/' });
    }
  }
  function targetPane(tab: DiffTab): WorkspacePane {
    return tabs.find((item) => sameTab(item, tab))?.pane ?? (rightTab ? 'right' : 'main');
  }
  function open(tab: DiffTab) {
    const pane = targetPane(tab);
    if (pane === 'right') {
      place(tab, pane);
    } else {
      setActivePane('main');
      navigateMain(tab);
    }
  }
  function openFile(projectId: string, file: string) {
    const tab = { projectId, file: opening === 'files' ? file : undefined };
    const pane = targetPane(tab);
    if (opening === 'combined') {
      setFocus((current) => ({ projectId, file, pane, request: (current?.request ?? 0) + 1 }));
    }
    open(tab);
  }
  function split(tab: DiffTab) {
    if (!canSplit) {
      return;
    }
    place(tab, 'right');
    if (projectId === tab.projectId && file === tab.file) {
      returnToChat();
    }
  }
  function moveToMain(tab: DiffTab) {
    place(tab, 'main');
    navigateMain(tab);
  }
  useLayoutEffect(() => {
    if (sessionMatch) {
      setActivePane('main');
      lastSession.current = { ...sessionMatch.params, branch: sessionMatch.search.branch };
    }
    if (projectId) {
      setActivePane('main');
      setTabs((current) => {
        const existing = current.find((tab) => sameTab(tab, { projectId, file }));
        if (existing?.pane === 'main') {
          return current;
        }
        return [
          ...current.filter((tab) => !sameTab(tab, { projectId, file })),
          { projectId, file, pane: 'main' },
        ];
      });
    }
  }, [projectId, file, sessionMatch, setActivePane]);
  function close(tab: DiffTab) {
    const entry = tabs.find((item) => sameTab(item, tab));
    const next = tabs.filter((item) => !sameTab(item, tab));
    setTabs(next);
    if (entry?.pane === 'right') {
      if (rightTab && sameTab(rightTab, tab)) {
        const previous = next.findLast((item) => item.pane === 'right');
        setRightSelection(previous ?? null);
        if (!previous) {
          setActivePane('main');
        }
      }
    } else if (projectId === tab.projectId && file === tab.file) {
      const previous = next.findLast((item) => item.pane === 'main');
      if (previous) {
        navigateMain(previous);
      } else {
        returnToChat();
      }
    }
  }
  useLayoutEffect(() =>
    desktop?.onCloseTab(() => {
      if (activePane === 'right' && rightTab) {
        close(rightTab);
      } else if (projectId) {
        close({ projectId, file });
      }
    }),
  );
  return (
    <DiffTabsContext.Provider
      value={{
        tabs,
        rightTab,
        canSplit,
        split,
        moveToMain,
        open,
        close,
        opening,
        setOpening,
        settingsError,
        openFile,
        focus,
        visibleFiles,
        setVisibleFiles,
      }}
    >
      {children}
    </DiffTabsContext.Provider>
  );
}

export function useDiffTabs() {
  const context = useContext(DiffTabsContext);
  if (!context) {
    throw new Error('Diff tabs provider missing');
  }
  return context;
}

export function DiffTabs({ pane = 'main' }: { pane?: WorkspacePane }) {
  const { tabs, open, close, rightTab, canSplit, split, moveToMain } = useDiffTabs();
  const match = useMatch({ from: '/app/projects/$projectId/diff', shouldThrow: false });
  return tabs
    .filter((tab) => tab.pane === pane)
    .map((tab) => {
      const active =
        pane === 'right'
          ? Boolean(rightTab && sameTab(rightTab, tab))
          : match?.params.projectId === tab.projectId && match?.search.file === tab.file;
      const title = tab.file?.split('/').at(-1) ?? 'Diff';
      return (
        <WorkspaceTab
          key={JSON.stringify([tab.projectId, tab.file])}
          label={title}
          active={active}
          title={`${tab.file ?? 'All working-tree changes'}\nProject: ${tab.projectId}`}
          closeLabel={`Close ${title} diff`}
          icon={<FileDiff size={14} aria-hidden="true" />}
          onSelect={() => open(tab)}
          onClose={() => close(tab)}
          actions={
            <button
              type="button"
              className="session-tab-action"
              disabled={pane === 'main' && !canSplit}
              aria-label={
                pane === 'main' ? `Move ${title} to right group` : `Move ${title} to main group`
              }
              title={
                pane === 'main' && !canSplit
                  ? 'Open a conversation before splitting'
                  : pane === 'main'
                    ? 'Split right'
                    : 'Move to main group'
              }
              onClick={() => (pane === 'main' ? split(tab) : moveToMain(tab))}
            >
              {pane === 'main' ? (
                <PanelRightOpen size={14} aria-hidden="true" />
              ) : (
                <PanelLeftClose size={14} aria-hidden="true" />
              )}
            </button>
          }
        />
      );
    });
}
