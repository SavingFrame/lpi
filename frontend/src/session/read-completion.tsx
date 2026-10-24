import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { completionToView, ReadCompletions } from '../../../src/client/read-completion';
import { hasUnreadCompletion } from '../../../src/shared/session-read-state';
import type { Snapshot } from '../../../src/shared/snapshots';
import { markViewed } from '../client/api';
import { queryClient } from '../client/controllers';
import { Button } from '../components/ui/button';

/** Browser visibility and React lifecycle bind the shared read-completion controller. */
export function ReadCompletion({
  snapshot,
  synchronized,
  following,
}: {
  snapshot: Snapshot | null;
  synchronized: boolean;
  following: boolean;
}) {
  const paneVisible = useRef(false);
  const context = useRef<{ snapshot: Snapshot | null; synchronized: boolean; following: boolean }>({
    snapshot: null,
    synchronized: false,
    following: false,
  });
  const [controller] = useState(
    () =>
      new ReadCompletions({
        target: () =>
          completionToView(context.current.snapshot, {
            synchronized: context.current.synchronized,
            following: context.current.following,
            visible: document.visibilityState === 'visible' && paneVisible.current,
          }),
        dispatch: markViewed,
        refresh: () => {
          void queryClient.invalidateQueries({ queryKey: ['sessions'] });
        },
      }),
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const unread = snapshot ? hasUnreadCompletion(snapshot.readState) : false;
  useEffect(() => {
    context.current = { snapshot, synchronized, following };
    void controller.synchronize();
    return () => {
      context.current.synchronized = false;
    };
  }, [snapshot, synchronized, following, controller]);
  useEffect(() => {
    const pane = document.querySelector('.session-pane')?.closest('main');
    if (!pane) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        paneVisible.current = entries.some(
          (entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5,
        );
        void controller.synchronize();
      },
      { threshold: [0, 0.5] },
    );
    observer.observe(pane);
    return () => {
      paneVisible.current = false;
      observer.disconnect();
    };
  }, [controller]);
  useEffect(() => {
    const update = () => void controller.synchronize();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [controller]);
  if (!state.error || !unread) {
    return null;
  }
  return (
    <div className="banner error" role="alert">
      Read status could not be saved.
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!state.target || state.pending}
        onClick={() => void controller.retry()}
      >
        Retry saving read status
      </Button>
    </div>
  );
}
