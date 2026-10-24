import { useMatch } from '@tanstack/react-router';
import { FileDiff as DiffIcon, PanelRightClose, PanelRightOpen, RefreshCw } from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { useDiffTabs } from './diff-tabs';
import { useProjectDiff } from './use-project-diff';
import { useWorkspacePanes } from './workspace-panes';

export function Workspace({
  projectId,
  children,
}: {
  projectId?: string;
  children: (controls: ReactNode) => ReactNode;
}) {
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem('lpi:workspace-panel-open');
      return saved === null ? window.matchMedia('(min-width: 1200px)').matches : saved === 'true';
    } catch {
      return window.matchMedia('(min-width: 1200px)').matches;
    }
  });
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('lpi:workspace-panel-width'));
      return Number.isFinite(saved) && saved >= 280 && saved <= 900 ? saved : 320;
    } catch {
      return 320;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('lpi:workspace-panel-open', String(open));
      localStorage.setItem('lpi:workspace-panel-width', String(width));
    } catch {
      // Resizing and toggling remain usable without device storage.
    }
  }, [open, width]);
  const { rightTab, canSplit, split } = useDiffTabs();
  const splitOpen = Boolean(rightTab);
  useEffect(() => {
    if (splitOpen) {
      setOpen(false);
    }
  }, [splitOpen]);
  return (
    <div
      className={`workspace ${open && projectId ? 'workspace-panel-open' : ''} ${splitOpen ? 'workspace-split-open' : ''}`}
      style={{ '--workspace-panel-width': `${width}px` } as CSSProperties}
    >
      <div className="workspace-chat">
        {children(
          projectId && (
            <div className="workspace-toolbar" role="toolbar" aria-label="Workspace actions">
              <button
                type="button"
                aria-expanded={open}
                aria-controls="workspace-panel"
                onClick={() => setOpen(!open)}
                title="Toggle changes panel"
              >
                <DiffIcon size={15} aria-hidden="true" /> Diff
              </button>
              {canSplit && !rightTab && (
                <button
                  type="button"
                  aria-label="Split Diff"
                  title="Split Diff"
                  onClick={() => split({ projectId })}
                >
                  <PanelRightOpen size={15} aria-hidden="true" />
                </button>
              )}
            </div>
          ),
        )}
      </div>
      {projectId && open && (
        <aside id="workspace-panel" className="workspace-panel" aria-label="Project workspace">
          <button
            type="button"
            className="workspace-resize"
            aria-label="Resize workspace panel"
            title="Drag to resize. Left and Right arrows adjust width; Home resets."
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              event.preventDefault();
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                const right = event.currentTarget.parentElement?.getBoundingClientRect().right ?? 0;
                setWidth(Math.max(280, Math.min(900, right - event.clientX)));
              }
            }}
            onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                setWidth((current) =>
                  Math.max(280, Math.min(900, current + (event.key === 'ArrowLeft' ? 20 : -20))),
                );
              } else if (event.key === 'Home') {
                event.preventDefault();
                setWidth(320);
              }
            }}
          />
          <DiffPanel key={projectId} projectId={projectId} onClose={() => setOpen(false)} />
        </aside>
      )}
    </div>
  );
}

function DiffPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { query, files } = useProjectDiff(projectId);
  const { open, openFile, opening, visibleFiles, rightTab } = useDiffTabs();
  const { activePane } = useWorkspacePanes();
  const match = useMatch({ from: '/app/projects/$projectId/diff', shouldThrow: false });
  const activeTab =
    activePane === 'right'
      ? rightTab
      : match
        ? { projectId: match.params.projectId, file: match.search.file }
        : undefined;
  const visibleFile = visibleFiles[activePane];
  const selectedFile =
    activeTab?.projectId === projectId
      ? (activeTab.file ?? (visibleFile?.projectId === projectId ? visibleFile.file : undefined))
      : undefined;
  function openDiff(file?: string) {
    if (file) {
      openFile(projectId, file);
    } else {
      open({ projectId });
    }
    if (rightTab || window.matchMedia('(max-width: 1100px)').matches) {
      onClose();
    }
  }
  return (
    <>
      <div className="workspace-tabs">
        <strong>Changes</strong>
        <button type="button" aria-label="Close workspace panel" onClick={onClose}>
          <PanelRightClose size={16} aria-hidden="true" />
        </button>
      </div>
      <section className="workspace-diff" aria-label="Working-tree changes">
        <div className="workspace-diff-toolbar">
          <div>
            <strong>Working tree</strong>
            <span className="muted">
              Staged, unstaged and untracked ·{' '}
              {query.status === 'live'
                ? 'Live'
                : query.status === 'paused'
                  ? 'Paused'
                  : 'Connecting…'}
            </span>
          </div>
          <button
            type="button"
            aria-label="Refresh diff"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw
              size={15}
              aria-hidden="true"
              className={query.isFetching ? 'working-icon' : ''}
            />
          </button>
        </div>
        {(!files || files.length === 0) && query.data?.patch && (
          <div className="workspace-diff-toolbar">
            <button type="button" onClick={() => openDiff()}>
              <DiffIcon size={15} aria-hidden="true" /> Open diff
            </button>
          </div>
        )}
        {query.isPending && (
          <p className="workspace-notice" role="status">
            Loading changes…
          </p>
        )}
        {query.error && (
          <p className="workspace-notice error" role="alert">
            {query.error.message}
          </p>
        )}
        {query.data?.truncated && (
          <p className="workspace-notice">
            Some untracked files were omitted because the diff limit was reached.
          </p>
        )}
        {query.data && !query.data.patch && (
          <p className="workspace-notice muted">No working-tree changes.</p>
        )}
        {query.data?.patch && files && (
          <p className="workspace-diff-summary">
            {files.length} changed {files.length === 1 ? 'file' : 'files'}.{' '}
            {opening === 'combined'
              ? 'Select a file to jump to its diff.'
              : 'Select a file to open its own tab.'}
          </p>
        )}
        {files === null && (
          <p className="workspace-notice">
            Could not parse file list. Open diff to view the raw patch.
          </p>
        )}
        <div className="workspace-diff-files">
          {files?.map((file) => (
            <button
              type="button"
              key={file.name}
              className="workspace-diff-file"
              aria-current={selectedFile === file.name ? 'location' : undefined}
              title={
                opening === 'combined'
                  ? `Go to ${file.name} in Diff tab`
                  : `Open ${file.name} in a main tab`
              }
              onClick={() => openDiff(file.name)}
            >
              <DiffIcon size={14} aria-hidden="true" />
              <span className="workspace-file-name">{file.name}</span>
              <span className="diff-additions">
                +{file.hunks.reduce((sum, h) => sum + h.additionLines, 0)}
              </span>
              <span className="diff-deletions">
                −{file.hunks.reduce((sum, h) => sum + h.deletionLines, 0)}
              </span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
