import { useLayoutEffect, useRef, useState } from 'react';
import { chatScroll } from '../chat-scroll';

export function useChatScroll() {
  const pane = useRef<HTMLDivElement>(null);
  const scrolling = useRef<ReturnType<typeof chatScroll> | null>(null);
  const [following, setFollowing] = useState(true);
  useLayoutEffect(() => {
    const content = pane.current;
    const viewport = content?.closest('main');
    if (!content || !viewport) {
      return;
    }
    const controller = chatScroll(viewport, content, setFollowing);
    scrolling.current = controller;
    return () => {
      controller.disconnect();
      scrolling.current = null;
    };
  }, []);
  return { pane, following, follow: () => scrolling.current?.follow() };
}
