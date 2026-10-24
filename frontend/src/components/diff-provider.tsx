import { WorkerPoolContextProvider } from '@pierre/diffs/react';
import DiffWorker from '@pierre/diffs/worker/worker.js?worker';
import type { ReactNode } from 'react';

const poolOptions = {
  workerFactory: () => new DiffWorker(),
  poolSize: 2,
};
const highlighterOptions = {
  theme: 'github-dark',
  lineDiffType: 'word',
  maxLineDiffLength: 1000,
  tokenizeMaxLineLength: 1000,
} as const;

/** Keep syntax highlighting off the UI thread as deferred previews enter view. */
export function DiffProvider({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={highlighterOptions}>
      {children}
    </WorkerPoolContextProvider>
  );
}
