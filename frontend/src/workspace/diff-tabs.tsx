import { useMatch, useNavigate } from '@tanstack/react-router';
import { FileDiff } from 'lucide-react';
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

interface DiffTab {
  projectId: string;
  file?: string;
}

export type DiffOpening = 'combined' | 'files';

interface VisibleDiffFile {
  projectId: string;
  file: string;
}

interface DiffFocus extends VisibleDiffFile {
  request: number;
}

const openingKey = 'lpi:diff-opening:v1';

interface DiffTabsState {
  tabs: DiffTab[];
  opening: DiffOpening;
  setOpening: (opening: DiffOpening) => void;
  settingsError: string;
  openFile: (projectId: string, file: string) => void;
  focus: DiffFocus | null;
  visibleFile: VisibleDiffFile | null;
  setVisibleFile: Dispatch<SetStateAction<VisibleDiffFile | null>>;
  open: (tab: DiffTab) => void;
  close: (tab: DiffTab) => void;
}

const DiffTabsContext = createContext<DiffTabsState | null>(null);

export function DiffTabsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const diffMatch = useMatch({ from: '/app/projects/$projectId/diff', shouldThrow: false });
  const sessionMatch = useMatch({
    from: '/app/projects/$projectId/sessions/$sessionId',
    shouldThrow: false,
  });
  const projectId = diffMatch?.params.projectId;
  const file = diffMatch?.search.file;
  const [tabs, setTabs] = useState<DiffTab[]>([]);
  const [opening, updateOpening] = useState<DiffOpening>(() => {
    try {
      return localStorage.getItem(openingKey) === 'files' ? 'files' : 'combined';
    } catch {
      return 'combined';
    }
  });
  const [settingsError, setSettingsError] = useState('');
  const [focus, setFocus] = useState<DiffFocus | null>(null);
  const [visibleFile, setVisibleFile] = useState<VisibleDiffFile | null>(null);
  function setOpening(value: DiffOpening) {
    updateOpening(value);
    try {
      localStorage.setItem(openingKey, value);
      setSettingsError('');
    } catch {
      setSettingsError('Could not save diff preference. It will apply until the app reloads.');
    }
  }
  function openFile(projectId: string, file: string) {
    if (opening === 'combined') {
      setFocus((current) => ({ projectId, file, request: (current?.request ?? 0) + 1 }));
      open({ projectId });
    } else {
      open({ projectId, file });
    }
  }
  const lastSession = useRef<{ projectId: string; sessionId: string; branch?: string } | null>(
    null,
  );
  useLayoutEffect(() => {
    if (sessionMatch) {
      lastSession.current = { ...sessionMatch.params, branch: sessionMatch.search.branch };
    }
    if (projectId) {
      setTabs((current) =>
        current.some((tab) => tab.projectId === projectId && tab.file === file)
          ? current
          : [...current, { projectId, file }],
      );
    }
  }, [projectId, file, sessionMatch]);
  function open(tab: DiffTab) {
    void navigate({
      to: '/app/projects/$projectId/diff',
      params: { projectId: tab.projectId },
      search: tab.file ? { file: tab.file } : {},
    });
  }
  function close(tab: DiffTab) {
    const next = tabs.filter((item) => item.projectId !== tab.projectId || item.file !== tab.file);
    setTabs(next);
    if (projectId === tab.projectId && file === tab.file) {
      const previous = next.at(-1);
      if (previous) {
        open(previous);
      } else if (lastSession.current) {
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
  }
  useLayoutEffect(() =>
    desktop?.onCloseTab(() => {
      if (projectId) {
        close({ projectId, file });
      }
    }),
  );
  return (
    <DiffTabsContext.Provider
      value={{
        tabs,
        open,
        close,
        opening,
        setOpening,
        settingsError,
        openFile,
        focus,
        visibleFile,
        setVisibleFile,
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

export function DiffTabs() {
  const { tabs, open, close } = useDiffTabs();
  const match = useMatch({ from: '/app/projects/$projectId/diff', shouldThrow: false });
  return tabs.map((tab) => {
    const active = match?.params.projectId === tab.projectId && match?.search.file === tab.file;
    const title = tab.file?.split('/').at(-1) ?? 'Diff';
    return (
      <WorkspaceTab
        key={JSON.stringify(tab)}
        label={title}
        active={active}
        title={`${tab.file ?? 'All working-tree changes'}\nProject: ${tab.projectId}`}
        closeLabel={`Close ${title} diff`}
        icon={<FileDiff size={14} aria-hidden="true" />}
        onSelect={() => open(tab)}
        onClose={() => close(tab)}
      />
    );
  });
}
