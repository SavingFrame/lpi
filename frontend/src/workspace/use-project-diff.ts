import { parsePatchFiles } from '@pierre/diffs';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useRelay } from '../client/relay-context';

export function useProjectDiff(projectId: string) {
  const {
    client: { diffs },
  } = useRelay();
  const entry = useMemo(() => diffs.projectDiffEntry(projectId), [diffs, projectId]);
  const state = useSyncExternalStore(entry.controller.subscribe, entry.controller.getState);
  useEffect(() => diffs.retainProjectDiff(projectId, entry), [diffs, projectId, entry]);
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
