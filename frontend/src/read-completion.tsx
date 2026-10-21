import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { hasUnreadCompletion } from '../../src/session-read-state';
import { markViewed, type Snapshot } from './api';
import { queryClient } from './client';
import { Button } from './components/ui/button';

/** Acknowledge only the completion actually loaded and visible at the end of the transcript. */
export function ReadCompletion({
  snapshot,
  enabled,
}: {
  snapshot: Snapshot | null;
  enabled: boolean;
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
  const id = snapshot?.session.id;
  const completionId = snapshot?.readState.completionId;
  const unread = snapshot ? hasUnreadCompletion(snapshot.readState) : false;
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    if (!enabled || !visible || !unread || !id || !completionId) {
      return;
    }
    const key = `${id}:${completionId}`;
    if (!attempted.current.has(key)) {
      attempted.current.add(key);
      mutate({ id, completionId });
    }
  }, [enabled, visible, unread, id, completionId, mutate]);
  if (!mutation.error || !unread || !id || !completionId) {
    return null;
  }
  return (
    <div className="banner error" role="alert">
      Read status could not be saved.
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!enabled || !visible || mutation.isPending}
        onClick={() => mutate({ id, completionId })}
      >
        Retry saving read status
      </Button>
    </div>
  );
}
