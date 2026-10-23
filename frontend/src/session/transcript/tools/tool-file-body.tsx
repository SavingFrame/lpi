import { File, FileDiff } from '@pierre/diffs/react';
import { type ReactNode, useMemo, useState } from 'react';
import { DeferredContent } from '../../../components/deferred-content';
import { Disclosure } from '../../../components/disclosure';
import type { TranscriptTool } from '../transcript-state';
import { editDiff } from './edit-diff';
import { writePreview } from './write-preview';

export function ToolFileBody({ tool, children }: { tool: TranscriptTool; children: ReactNode }) {
  return (
    <DeferredContent label={`${tool.name} output`}>
      {() => <FilePreview tool={tool}>{children}</FilePreview>}
    </DeferredContent>
  );
}

function FilePreview({ tool, children }: { tool: TranscriptTool; children: ReactNode }) {
  const fileDiff = useMemo(() => editDiff(tool), [tool]);
  const file = useMemo(() => writePreview(tool), [tool]);
  const [style, setStyle] = useState<'unified' | 'split'>('unified');
  if (!fileDiff && !file) {
    return children;
  }
  return (
    <>
      {file ? (
        <section className="edit-diff" aria-label="Write content preview">
          <div className="edit-diff-toolbar">
            <span className="tool-name">Content preview</span>
          </div>
          <File
            file={file}
            options={{
              theme: 'github-dark',
              themeType: 'dark',
              overflow: 'scroll',
              tokenizeMaxLineLength: 1000,
            }}
          />
        </section>
      ) : fileDiff ? (
        <section className="edit-diff" aria-label="Applied edit">
          <div className="edit-diff-toolbar">
            <span className="tool-name">Applied changes</span>
            <label>
              View
              <select
                value={style}
                onChange={(event) => setStyle(event.target.value === 'split' ? 'split' : 'unified')}
              >
                <option value="unified">Unified</option>
                <option value="split">Split</option>
              </select>
            </label>
          </div>
          <FileDiff
            fileDiff={fileDiff}
            options={{
              theme: 'github-dark',
              themeType: 'dark',
              diffStyle: style,
              overflow: 'scroll',
              lineDiffType: 'word',
              hunkSeparators: 'line-info',
              tokenizeMaxLineLength: 1000,
              maxLineDiffLength: 1000,
            }}
          />
        </section>
      ) : null}
      <Disclosure className="edit-raw" summary="Raw arguments and output">
        {() => children}
      </Disclosure>
    </>
  );
}
