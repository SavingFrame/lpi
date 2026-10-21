import { queryOptions } from '@tanstack/react-query';
import { tree } from './api.ts';

/** Only session details may fetch. Sidebar observers consume the same cache passively. */
export function sessionTreeQuery(id: string, source: 'details' | 'sidebar') {
  return queryOptions({
    queryKey: ['tree', id],
    queryFn: ({ signal }) => tree(id, signal),
    enabled: source === 'details',
    retry: false,
  });
}
