import { parsePatchFiles } from '@pierre/diffs';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { diff } from '../client/api';

export function useProjectDiff(projectId: string) {
  const query = useQuery({
    queryKey: ['project-diff', projectId],
    queryFn: ({ signal }) => diff(projectId, signal),
    staleTime: 0,
    retry: false,
  });
  const files = useMemo(() => {
    try {
      return query.data ? parsePatchFiles(query.data.patch).flatMap((patch) => patch.files) : [];
    } catch {
      return null;
    }
  }, [query.data]);
  return { query, files };
}
