import type { FileDiffMetadata } from '@pierre/diffs';
import { useEffect, useRef } from 'react';
import { useDiffTabs } from './diff-tabs';
import type { WorkspacePane } from './workspace-panes';

/** Keep requested anchors aligned as deferred diffs acquire their real heights. */
export function useDiffScroll(
  projectId: string,
  file: string | undefined,
  files: FileDiffMetadata[] | null,
  pane: WorkspacePane,
) {
  const page = useRef<HTMLDivElement>(null);
  const releasedRequest = useRef<number | undefined>(undefined);
  const { focus, setVisibleFiles } = useDiffTabs();
  useEffect(() => {
    const root = page.current;
    const main = root?.closest<HTMLElement>('[data-workspace-scroll], main');
    if (!root || !main || !files) {
      return;
    }
    const sections = [...root.querySelectorAll<HTMLElement>('[data-diff-file]')];
    let anchor =
      !file &&
      focus?.projectId === projectId &&
      focus.pane === pane &&
      focus.request !== releasedRequest.current
        ? sections.find((section) => section.dataset.diffFile === focus.file)
        : undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top =
        main.getBoundingClientRect().top +
        (root.querySelector('header')?.getBoundingClientRect().height ?? 0);
      if (anchor) {
        main.scrollTop += anchor.getBoundingClientRect().top - top;
      }
      let current = sections[0];
      for (const section of sections) {
        if (section.getBoundingClientRect().top > top + 2) {
          break;
        }
        current = section;
      }
      if (
        main.scrollHeight > main.clientHeight &&
        main.scrollTop + main.clientHeight >= main.scrollHeight - 2
      ) {
        current = sections.at(-1);
      }
      const name = current?.dataset.diffFile;
      setVisibleFiles((previous) => {
        const current = previous[pane];
        if (!name) {
          return current === null ? previous : { ...previous, [pane]: null };
        }
        return current?.projectId === projectId && current.file === name
          ? previous
          : { ...previous, [pane]: { projectId, file: name } };
      });
    };
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(update);
      }
    };
    const release = () => {
      anchor = undefined;
      if (focus?.pane === pane) {
        releasedRequest.current = focus.request;
      }
    };
    // Real user scrolling wins over a pending anchor. Layout changes must not pull it back.
    main.addEventListener('wheel', release, { passive: true });
    main.addEventListener('touchstart', release, { passive: true });
    main.addEventListener('pointerdown', release);
    main.addEventListener('keydown', release);
    main.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    observer.observe(main);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      main.removeEventListener('wheel', release);
      main.removeEventListener('touchstart', release);
      main.removeEventListener('pointerdown', release);
      main.removeEventListener('keydown', release);
      main.removeEventListener('scroll', schedule);
    };
  }, [projectId, file, files, focus, pane, setVisibleFiles]);
  return page;
}
