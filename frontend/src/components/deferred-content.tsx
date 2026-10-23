import { type ReactNode, useEffect, useRef, useState } from 'react';

/** Mount expensive previews near the viewport, and keep their state after first exposure. */
export function DeferredContent({ label, children }: { label: string; children: () => ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const target = element.current;
    if (ready || !target) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setReady(true);
          observer.disconnect();
        }
      },
      { root: target.closest('main'), rootMargin: '400px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [ready]);
  return (
    <div ref={element} className={ready ? undefined : 'deferred-preview'}>
      {ready ? (
        children()
      ) : (
        <button type="button" onClick={() => setReady(true)}>
          Load {label}
        </button>
      )}
    </div>
  );
}
