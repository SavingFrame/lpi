import { createContext, type ReactNode, useContext, useState } from 'react';

export type WorkspacePane = 'main' | 'right';

const PaneContext = createContext<{
  activePane: WorkspacePane;
  setActivePane: (pane: WorkspacePane) => void;
} | null>(null);

export function WorkspacePanesProvider({ children }: { children: ReactNode }) {
  const [activePane, setActivePane] = useState<WorkspacePane>('main');
  return (
    <PaneContext.Provider value={{ activePane, setActivePane }}>{children}</PaneContext.Provider>
  );
}

export function useWorkspacePanes() {
  const context = useContext(PaneContext);
  if (!context) {
    throw new Error('Workspace panes provider missing');
  }
  return context;
}

/** A tab group has no knowledge of sessions, diffs, or routing. */
export function WorkspaceGroup({
  pane,
  tabs,
  children,
}: {
  pane: WorkspacePane;
  tabs: ReactNode;
  children: ReactNode;
}) {
  const { activePane, setActivePane } = useWorkspacePanes();
  return (
    <section
      className={`workspace-group ${activePane === pane ? 'focused' : ''}`}
      aria-label={pane === 'main' ? 'Main tab group' : 'Right tab group'}
      data-workspace-pane={pane}
      onPointerDownCapture={() => setActivePane(pane)}
      onFocusCapture={() => setActivePane(pane)}
    >
      {tabs}
      {children}
    </section>
  );
}
