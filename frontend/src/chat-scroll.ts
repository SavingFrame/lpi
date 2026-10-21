export function chatScroll(
  viewport: HTMLElement,
  content: HTMLElement,
  onFollowingChange: (following: boolean) => void,
) {
  let following = true;
  let previousTop = viewport.scrollTop;
  const follow = () => {
    following = true;
    viewport.scrollTop = viewport.scrollHeight;
    previousTop = viewport.scrollTop;
    onFollowingChange(true);
  };
  const onScroll = () => {
    const nearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 64;
    // Content growth can emit a scroll event without the reader moving.
    if (viewport.scrollTop !== previousTop || nearBottom) {
      following = nearBottom;
      onFollowingChange(following);
    }
    previousTop = viewport.scrollTop;
  };
  const observer = new ResizeObserver(() => {
    if (following) {
      follow();
    }
  });
  viewport.addEventListener('scroll', onScroll, { passive: true });
  observer.observe(content);
  observer.observe(viewport);
  follow();
  return {
    follow,
    disconnect: () => {
      viewport.removeEventListener('scroll', onScroll);
      observer.disconnect();
    },
  };
}
