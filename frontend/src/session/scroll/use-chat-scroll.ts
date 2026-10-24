import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { desktop } from '../../client/platform';
import { chatScroll } from './chat-scroll';

const positions = new Map<string, { top: number; following: boolean }>();

export function useChatScroll(id: string, ready: boolean) {
  const pane = useRef<HTMLDivElement>(null);
  const scrolling = useRef<ReturnType<typeof chatScroll> | null>(null);
  const [following, setFollowing] = useState(() =>
    desktop ? (positions.get(id)?.following ?? true) : true,
  );
  const enabled = !desktop || ready;
  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }
    const content = pane.current;
    const viewport = content?.closest('main');
    if (!content || !viewport) {
      return;
    }
    const controller = chatScroll(
      viewport,
      content,
      setFollowing,
      desktop ? positions.get(id) : undefined,
    );
    scrolling.current = controller;
    return () => {
      if (desktop) {
        positions.set(id, controller.position());
      }
      controller.disconnect();
      scrolling.current = null;
    };
  }, [id, enabled]);
  const pause = useCallback(() => scrolling.current?.pause(), []);
  return { pane, following, follow: () => scrolling.current?.follow(), pause };
}
