import { FileDiff } from '@pierre/diffs/react';
import { type ReactNode, useMemo, useState } from 'react';
import { Disclosure } from './components/disclosure';
import { editDiff } from './edit-diff';
import type { TranscriptTool } from './transcript-state';

export function EditToolBody({ tool, children }: { tool: TranscriptTool; children: ReactNode }) {
  const fileDiff = useMemo(() => editDiff(tool), [tool]);
  const [style, setStyle] = useState<'unified' | 'split'>('unified');
  if (!fileDiff) {
    return children;
  }
  return (
    <>
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
      <Disclosure className="edit-raw" summary="Raw arguments and output">
        {() => children}
      </Disclosure>
    </>
  );
}
