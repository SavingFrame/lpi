import { createElement, type ReactNode, type ToggleEvent, useState } from 'react';

/** Native keyboard/click behavior, without mounting hidden content. Keep it mounted after opening. */
export function Disclosure({
  summary,
  children,
  className,
  defaultOpen = false,
}: {
  summary: ReactNode;
  children: () => ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [visited, setVisited] = useState(defaultOpen);
  return createElement(
    'details',
    {
      className,
      open: open || undefined,
      onToggle: (event: ToggleEvent<HTMLDetailsElement>) => {
        setOpen(event.currentTarget.open);
        if (event.currentTarget.open) {
          setVisited(true);
        }
      },
    },
    createElement('summary', null, summary),
    visited ? children() : null,
  );
}
