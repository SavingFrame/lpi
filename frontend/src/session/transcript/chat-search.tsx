import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { nextTextMatch } from '../../../../src/client/text-search';
import { Button } from '../../components/ui/button';
import { conversationRanges } from './conversation-ranges';

export function ChatSearch({
  pane,
  open,
  onOpenChange,
  trigger,
  onNavigate,
}: {
  pane: RefObject<HTMLDivElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: RefObject<HTMLButtonElement | null>;
  onNavigate: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [ranges, setRanges] = useState<Range[]>([]);
  const [selected, setSelected] = useState(0);
  const previous = useRef<Range | null>(null);
  const current = Math.min(selected, Math.max(0, ranges.length - 1));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.shiftKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'f' ||
        document.querySelector('dialog[open]') ||
        (event.target instanceof Element && event.target.closest('[data-shortcut-recorder]'))
      ) {
        return;
      }
      event.preventDefault();
      onOpenChange(true);
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpenChange]);

  useLayoutEffect(() => {
    if (open) {
      input.current?.focus();
      input.current?.select();
    }
  }, [open]);

  useLayoutEffect(() => {
    const content = pane.current;
    if (!open || !content) {
      setRanges([]);
      return;
    }
    const update = () => setRanges(conversationRanges(content, query));
    update();
    const observer = new MutationObserver(update);
    observer.observe(content, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [open, query, pane]);

  useLayoutEffect(() => {
    if (!open) {
      previous.current = null;
      return;
    }
    const active = ranges[current];
    const last = previous.current;
    if (active && (!last || active.compareBoundaryPoints(Range.START_TO_START, last) !== 0)) {
      onNavigate();
      // Reveal content-visibility sections before measuring the exact occurrence.
      active.startContainer.parentElement?.scrollIntoView({ block: 'center' });
      const viewport = pane.current?.closest('main');
      if (viewport) {
        const bounds = viewport.getBoundingClientRect();
        const header = pane.current?.querySelector('.session-topbar')?.getBoundingClientRect();
        const top = Math.max(bounds.top, header?.bottom ?? bounds.top);
        const match = active.getBoundingClientRect();
        viewport.scrollBy({ top: match.top - (top + (bounds.bottom - top) / 2) });
      }
    }
    previous.current = active ?? null;
    if (!CSS.highlights || typeof Highlight === 'undefined') {
      return;
    }
    const matches = new Highlight();
    for (const range of ranges) {
      matches.add(range);
    }
    CSS.highlights.set('chat-search', matches);
    CSS.highlights.set('chat-search-active', new Highlight(...(active ? [active] : [])));
    return () => {
      CSS.highlights.delete('chat-search');
      CSS.highlights.delete('chat-search-active');
    };
  }, [open, ranges, current, onNavigate, pane]);

  if (!open) {
    return null;
  }
  const move = (direction: number) => {
    setSelected(nextTextMatch(current, direction, ranges.length));
  };
  const close = () => {
    onOpenChange(false);
    trigger.current?.focus({ preventScroll: true });
  };
  return (
    <search
      className="chat-search"
      aria-label="Search current chat"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <input
        ref={input}
        type="search"
        aria-label="Search messages and replies"
        placeholder="Search messages and replies…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setSelected(0);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) {
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            move(event.shiftKey ? -1 : 1);
          }
        }}
      />
      <span className="muted" role="status" aria-live="polite">
        {query
          ? ranges.length
            ? `${current + 1} of ${ranges.length}`
            : 'No matches'
          : 'Enter text'}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Previous match"
        disabled={!ranges.length}
        onClick={() => move(-1)}
      >
        <ArrowUp aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Next match"
        disabled={!ranges.length}
        onClick={() => move(1)}
      >
        <ArrowDown aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Close chat search"
        onClick={close}
      >
        <X aria-hidden="true" />
      </Button>
    </search>
  );
}
