import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { hasUnreadCompletion } from '../../src/shared/session-read-state';
import type { Snapshot } from '../../src/shared/snapshots';
import { markViewed } from './api';
import { queryClient } from './client';
import { Button } from './components/ui/button';
import { completionToView } from './session/read-completion';

/** Acknowledge only the completion actually loaded and visible at the end of the transcript. */
export function ReadCompletion({
  snapshot,
  synchronized,
  following,
}: {
  snapshot: Snapshot | null;
  synchronized: boolean;
  following: boolean;
}) {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const attempted = useRef(new Set<string>());
  const mutation = useMutation({
    mutationFn: ({ id, completionId }: { id: string; completionId: string }) =>
      markViewed(id, completionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  const { mutate } = mutation;
  const target = completionToView(snapshot, { synchronized, following, visible });
  const id = target?.id;
  const completionId = target?.completionId;
  const unread = snapshot ? hasUnreadCompletion(snapshot.readState) : false;
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    if (!id || !completionId) {
      return;
    }
    const key = `${id}:${completionId}`;
    if (!attempted.current.has(key)) {
      attempted.current.add(key);
      mutate({ id, completionId });
    }
  }, [id, completionId, mutate]);
  if (!mutation.error || !unread) {
    return null;
  }
  return (
    <div className="banner error" role="alert">
      Read status could not be saved.
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!target || mutation.isPending}
        onClick={() => {
          if (target) {
            mutate(target);
          }
        }}
      >
        Retry saving read status
      </Button>
    </div>
  );
}
