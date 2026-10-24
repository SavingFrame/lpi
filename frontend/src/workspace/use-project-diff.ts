import { parsePatchFiles } from '@pierre/diffs';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { projectDiffEntry, retainProjectDiff } from '../client/project-diff';

export function useProjectDiff(projectId: string) {
  const entry = useMemo(() => projectDiffEntry(projectId), [projectId]);
  const state = useSyncExternalStore(entry.controller.subscribe, entry.controller.getState);
  useEffect(() => retainProjectDiff(projectId, entry), [projectId, entry]);
  const files = useMemo(() => {
    try {
      return state.data ? parsePatchFiles(state.data.patch).flatMap((patch) => patch.files) : [];
    } catch {
      return null;
    }
  }, [state.data]);
  return {
    query: {
      data: state.data,
      isPending: !state.data && !state.error,
      isFetching: state.loading,
      error: state.error,
      refetch: entry.controller.refresh,
      status: state.status,
    },
    files,
  };
}
