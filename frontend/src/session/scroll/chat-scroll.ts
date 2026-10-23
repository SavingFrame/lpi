export function chatScroll(
  viewport: HTMLElement,
  content: HTMLElement,
  onFollowingChange: (following: boolean) => void,
) {
  let following = true;
  let previousTop = viewport.scrollTop;
  let previousHeight = viewport.scrollHeight;
  let previousClientHeight = viewport.clientHeight;
  const follow = () => {
    following = true;
    viewport.scrollTop = viewport.scrollHeight;
    previousTop = viewport.scrollTop;
    previousHeight = viewport.scrollHeight;
    previousClientHeight = viewport.clientHeight;
    onFollowingChange(true);
  };
  const onScroll = () => {
    const nearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 64;
    const resized =
      viewport.scrollHeight !== previousHeight || viewport.clientHeight !== previousClientHeight;
    // Browser scroll anchoring and clamping can move scrollTop during layout changes.
    if ((!resized && viewport.scrollTop !== previousTop) || nearBottom) {
      following = nearBottom;
      onFollowingChange(following);
    }
    previousTop = viewport.scrollTop;
    previousHeight = viewport.scrollHeight;
    previousClientHeight = viewport.clientHeight;
  };
  const onClick = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('summary')) {
      following = false;
      onFollowingChange(false);
    }
  };
  const observer = new ResizeObserver(() => {
    if (following) {
      follow();
    }
  });
  // Pause before the native details toggle changes layout, including keyboard clicks.
  viewport.addEventListener('click', onClick, { capture: true });
  viewport.addEventListener('scroll', onScroll, { passive: true });
  observer.observe(content);
  observer.observe(viewport);
  follow();
  return {
    follow,
    disconnect: () => {
      viewport.removeEventListener('click', onClick, { capture: true });
      viewport.removeEventListener('scroll', onScroll);
      observer.disconnect();
    },
  };
}
