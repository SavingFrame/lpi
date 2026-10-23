import {
  type KeyboardEvent,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export interface WindowedItem {
  key: string;
  estimate: number;
  content: ReactNode;
}

const focusable =
  'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),summary';

/** Variable-height navigation rows. Only the viewport, overscan, and focused row are mounted. */
export function WindowedList({ items, resetKey }: { items: WindowedItem[]; resetKey: string }) {
  const root = useRef<HTMLUListElement>(null);
  const [heights, setHeights] = useState(() => new Map<string, number>());
  const lastReset = useRef<string | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const [focused, setFocused] = useState<string | null>(null);
  const pendingFocus = useRef<{ key: string; backwards: boolean; primary?: boolean } | null>(null);
  const layout = useMemo(() => {
    let top = 0;
    const rows = items.map((item, index) => {
      const height = heights.get(item.key) ?? item.estimate;
      const row = { ...item, index, top, height };
      top += height;
      return row;
    });
    return { rows, height: top };
  }, [items, heights]);
  const visible = useMemo(
    () =>
      layout.rows.filter(
        (row) =>
          (row.top + row.height >= viewport.top - 350 &&
            row.top <= viewport.top + viewport.height + 350) ||
          row.key === focused,
      ),
    [layout, viewport, focused],
  );

  useLayoutEffect(() => {
    const element = root.current;
    const scroll = element?.closest('nav');
    if (!element || !scroll) {
      return;
    }
    let frame = 0;
    const read = () => {
      frame = 0;
      const top = Math.max(
        0,
        scroll.getBoundingClientRect().top - element.getBoundingClientRect().top,
      );
      const height = scroll.clientHeight;
      setViewport((current) =>
        current.top === top && current.height === height ? current : { top, height },
      );
    };
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(read);
      }
    };
    if (lastReset.current !== resetKey) {
      lastReset.current = resetKey;
      scroll.scrollTop = 0;
    }
    read();
    scroll.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(scroll);
    return () => {
      cancelAnimationFrame(frame);
      scroll.removeEventListener('scroll', schedule);
      observer.disconnect();
    };
  }, [resetKey]);

  useLayoutEffect(() => {
    const element = root.current;
    const scroll = element?.closest('nav');
    if (!element || !scroll) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const measured = new Map<string, number>();
      let adjustment = 0;
      const top = Math.max(
        0,
        scroll.getBoundingClientRect().top - element.getBoundingClientRect().top,
      );
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.windowKey;
        const row = visible.find((item) => item.key === key);
        const height =
          entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
        if (!row || Math.abs(row.height - height) < 0.5) {
          continue;
        }
        measured.set(row.key, height);
        if (row.top + row.height < top) {
          adjustment += height - row.height;
        }
      }
      if (measured.size) {
        if (adjustment) {
          scroll.scrollTop += adjustment;
        }
        setHeights((current) => new Map([...current, ...measured]));
      }
    });
    for (const child of element.children) {
      observer.observe(child);
    }
    const request = pendingFocus.current;
    if (request) {
      const row = Array.from(element.children).find(
        (child) => (child as HTMLElement).dataset.windowKey === request.key,
      );
      const targets = row?.querySelectorAll<HTMLElement>(focusable);
      const target = request.primary
        ? (row?.querySelector<HTMLElement>('.session-link, .project-toggle') ??
          row?.querySelector<HTMLElement>('button:not(:disabled)'))
        : request.backwards
          ? targets?.[targets.length - 1]
          : targets?.[0];
      if (target) {
        pendingFocus.current = null;
        target.focus();
      }
    }
    return () => observer.disconnect();
  }, [visible]);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const arrow = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    if (
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      (arrow &&
        (event.target as HTMLElement).matches(
          'input, textarea, select, [contenteditable="true"]',
        )) ||
      (!arrow && event.key !== 'Tab') ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      (arrow && event.shiftKey)
    ) {
      return;
    }
    const target = event.target as HTMLElement;
    const element = target.closest<HTMLElement>('[data-window-key]');
    const index = Number(element?.dataset.windowIndex);
    const row = layout.rows[index];
    if (!element || !row) {
      return;
    }
    const backwards = arrow ? event.key === 'ArrowUp' : event.shiftKey;
    const targets = element.querySelectorAll<HTMLElement>(focusable);
    if (!arrow && target !== (backwards ? targets[0] : targets[targets.length - 1])) {
      return;
    }
    const next = layout.rows[index + (backwards ? -1 : 1)];
    if (!next) {
      return;
    }
    if (!arrow && visible.some((item) => item.key === next.key)) {
      return;
    }
    event.preventDefault();
    pendingFocus.current = { key: next.key, backwards: arrow ? false : backwards, primary: arrow };
    const scroll = root.current?.closest('nav');
    if (scroll && root.current) {
      const offset = root.current.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
      scroll.scrollTop += offset + next.top;
    }
    setFocused(next.key);
  };

  return (
    <ul
      ref={root}
      className="windowed-list"
      aria-label="Projects and sessions"
      style={{ height: layout.height }}
      onKeyDown={onKeyDown}
      onFocusCapture={(event) => {
        const row = (event.target as HTMLElement).closest<HTMLElement>('[data-window-key]');
        setFocused(row?.dataset.windowKey ?? null);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(null);
        }
      }}
    >
      {visible.map((row) => (
        <li
          key={row.key}
          className="windowed-row"
          aria-posinset={row.index + 1}
          aria-setsize={items.length}
          data-window-key={row.key}
          data-window-index={row.index}
          style={{ top: row.top }}
        >
          {row.content}
        </li>
      ))}
    </ul>
  );
}
