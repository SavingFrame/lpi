import type { FileDiffMetadata } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { useParams, useSearch } from '@tanstack/react-router';
import { RefreshCw } from 'lucide-react';
import { DeferredContent } from '../components/deferred-content';
import { useDiffScroll } from './use-diff-scroll';
import { useProjectDiff } from './use-project-diff';
import type { WorkspacePane } from './workspace-panes';

export function DiffPage() {
  const { projectId } = useParams({ from: '/app/projects/$projectId/diff' });
  const { file } = useSearch({ from: '/app/projects/$projectId/diff' });
  return <DiffView projectId={projectId} file={file} />;
}

export function DiffView({
  projectId,
  file,
  pane = 'main',
}: {
  projectId: string;
  file?: string;
  pane?: WorkspacePane;
}) {
  const { query, files } = useProjectDiff(projectId);
  const page = useDiffScroll(projectId, file, files, pane);
  const visible = file ? files?.filter((entry) => entry.name === file) : files;
  return (
    <div className="diff-page" ref={page}>
      <header className="workspace-diff-toolbar">
        <div>
          <h1>{file ?? 'Working-tree diff'}</h1>
          <span className="muted">Current changes against HEAD</span>
        </div>
        <button
          type="button"
          aria-label="Refresh diff tab"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" /> Refresh
        </button>
      </header>
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
      {query.data?.patch && file && visible?.length === 0 && (
        <p className="workspace-notice muted">This file is no longer in the current diff.</p>
      )}
      {visible?.map((entry) => (
        <DiffFile key={entry.name} file={entry} />
      ))}
      {query.data?.patch && (files === null || files.length === 0) && (
        <pre className="workspace-raw-patch">{query.data.patch}</pre>
      )}
    </div>
  );
}

function DiffFile({ file }: { file: FileDiffMetadata }) {
  return (
    <section className="workspace-combined-file" aria-label={file.name} data-diff-file={file.name}>
      <h2>
        <span className="workspace-file-name">{file.name}</span>
        <span className="diff-additions">
          +{file.hunks.reduce((sum, h) => sum + h.additionLines, 0)}
        </span>
        <span className="diff-deletions">
          −{file.hunks.reduce((sum, h) => sum + h.deletionLines, 0)}
        </span>
      </h2>
      {file.hunks.length ? (
        <DeferredContent label={file.name}>
          {() => (
            <FileDiff
              fileDiff={file}
              options={{
                theme: 'github-dark',
                themeType: 'dark',
                diffStyle: 'unified',
                overflow: 'scroll',
                disableFileHeader: true,
                hunkSeparators: 'line-info',
                tokenizeMaxLineLength: 1000,
                maxLineDiffLength: 1000,
              }}
            />
          )}
        </DeferredContent>
      ) : (
        <p className="workspace-notice muted">Binary file, rename, or metadata-only change.</p>
      )}
    </section>
  );
}
